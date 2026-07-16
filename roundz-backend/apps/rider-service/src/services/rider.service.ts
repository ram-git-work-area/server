import { randomUUID } from 'node:crypto';
import type { Rider, RiderDocumentType, RiderPreference, Vehicle } from '@prisma/client';
import type { ObjectStorageProvider } from '@roundz/cloud';
import { AppError } from '@roundz/errors';
import { KafkaTopics } from '@roundz/kafka';
import { validate } from '@roundz/validation';
import type { RiderEventName, RiderEventPublisher } from '../events/rider-events.publisher';
import type {
  CreateVehicleData,
  RiderRepositoryPort,
  UpdateVehicleData,
} from '../repositories/rider.repository';
import {
  apiResponseSchema,
  collectionResponseSchema,
  messageResponseSchema,
  riderDocumentSchema,
  riderPreferenceSchema,
  riderProfileSchema,
  riderStatusResponseSchema,
  vehicleSchema,
  type CreateVehicleRequest,
  type DocumentUpload,
  type PaginationQuery,
  type UpdatePreferencesRequest,
  type UpdateProfileRequest,
  type UpdateStatusRequest,
  type UpdateVehicleRequest,
} from '../schemas/rider.schemas';
import {
  assertFutureExpiry,
  assertValidLanguageCode,
  assertValidStorageUri,
} from '../validators/rider.validators';
import {
  preferenceCacheKey,
  riderProfileCacheKey,
  vehicleListCacheKey,
  type RiderCache,
} from './rider-cache.service';

export type RequestContext = {
  requestId: string;
  traceId?: string;
};

export type RiderServiceOptions = {
  repository: RiderRepositoryPort;
  cache: RiderCache;
  eventPublisher: RiderEventPublisher;
  storageProvider: ObjectStorageProvider;
  documentBucket: string;
  cacheTtlSeconds: number;
};

const REQUIRED_DOCUMENT_TYPES: RiderDocumentType[] = [
  'DRIVING_LICENSE',
  'VEHICLE_RC',
  'IDENTITY_PROOF',
];

export class RiderService {
  constructor(private readonly options: RiderServiceOptions) {}

  async getProfile(userId: string) {
    const cacheKey = riderProfileCacheKey(userId);
    const cached = await this.options.cache.getJson<Rider>(cacheKey);

    if (cached) {
      return validate(apiResponseSchema(riderProfileSchema), { data: normalizeRiderDates(cached) });
    }

    const rider = await this.options.repository.findRiderByUserId(userId);

    if (!rider) {
      throw new AppError('Rider profile not found', 404, 'RIDER_NOT_FOUND');
    }

    await this.options.cache.setJson(cacheKey, rider, this.options.cacheTtlSeconds);
    return validate(apiResponseSchema(riderProfileSchema), { data: rider });
  }

  async updateProfile(userId: string, input: UpdateProfileRequest, context: RequestContext) {
    assertValidStorageUri(input.profilePhoto);

    const { rider, created } = await this.getOrCreateRider(userId);

    if (created) {
      await this.publish(KafkaTopics.RiderCreated, rider.id, {
        riderId: rider.id,
        userId,
        riderCode: rider.riderCode,
        requestId: context.requestId,
        traceId: context.traceId,
      });
    }

    const updated =
      input.profilePhoto === undefined
        ? rider
        : await this.options.repository.updateRider(rider.id, { profilePhoto: input.profilePhoto });

    const withOnboarding = await this.recomputeOnboardingStatus(updated);

    await this.invalidateProfile(userId);
    await this.publish(KafkaTopics.RiderProfileUpdated, withOnboarding.id, {
      riderId: withOnboarding.id,
      userId,
      requestId: context.requestId,
      traceId: context.traceId,
      changedFields: Object.keys(input),
    });

    return validate(apiResponseSchema(riderProfileSchema), { data: withOnboarding });
  }

  async getStatus(userId: string) {
    const rider = await this.resolveRider(userId);

    return validate(apiResponseSchema(riderStatusResponseSchema), {
      data: {
        onlineStatus: rider.onlineStatus,
        onboardingStatus: rider.onboardingStatus,
        approvalStatus: rider.approvalStatus,
      },
    });
  }

  async updateStatus(userId: string, input: UpdateStatusRequest, context: RequestContext) {
    const rider = await this.resolveRider(userId);

    if (input.onlineStatus === 'ONLINE' || input.onlineStatus === 'BUSY') {
      if (rider.onboardingStatus !== 'COMPLETED') {
        throw new AppError(
          'Rider onboarding must be completed before going online',
          409,
          'RIDER_ONBOARDING_INCOMPLETE',
        );
      }

      if (rider.approvalStatus !== 'APPROVED') {
        throw new AppError('Rider must be approved before going online', 409, 'RIDER_NOT_APPROVED');
      }
    }

    const updated = await this.options.repository.updateRider(rider.id, {
      onlineStatus: input.onlineStatus,
    });

    await this.invalidateProfile(userId);
    await this.publish(KafkaTopics.RiderStatusChanged, updated.id, {
      riderId: updated.id,
      userId,
      requestId: context.requestId,
      traceId: context.traceId,
      previousStatus: rider.onlineStatus,
      onlineStatus: updated.onlineStatus,
    });

    return validate(apiResponseSchema(riderStatusResponseSchema), {
      data: {
        onlineStatus: updated.onlineStatus,
        onboardingStatus: updated.onboardingStatus,
        approvalStatus: updated.approvalStatus,
      },
    });
  }

  async listVehicles(userId: string, pagination: PaginationQuery) {
    const rider = await this.resolveRider(userId);
    const vehicles = await this.getCachedVehicles(rider.id);

    return validate(
      collectionResponseSchema(vehicleSchema),
      paginateList(vehicles, pagination.limit, pagination.cursor),
    );
  }

  async createVehicle(userId: string, input: CreateVehicleRequest, context: RequestContext) {
    const rider = await this.resolveRider(userId);
    assertFutureExpiry(
      'Insurance expiry',
      input.insuranceExpiry,
      'RIDER_VEHICLE_INSURANCE_EXPIRED',
    );
    assertFutureExpiry('Permit expiry', input.permitExpiry, 'RIDER_VEHICLE_PERMIT_EXPIRED');
    await this.assertRegistrationAvailable(input.registrationNumber);

    const vehicle = await this.options.repository.createVehicle(
      rider.id,
      toCreateVehicleData(input),
    );

    await this.invalidateVehicles(rider.id);
    await this.recomputeOnboardingStatus(rider);
    await this.invalidateProfile(userId);
    await this.publish(KafkaTopics.RiderVehicleCreated, vehicle.id, {
      riderId: rider.id,
      userId,
      vehicleId: vehicle.id,
      requestId: context.requestId,
      traceId: context.traceId,
    });

    return validate(apiResponseSchema(vehicleSchema), { data: vehicle });
  }

  async updateVehicle(
    userId: string,
    vehicleId: string,
    input: UpdateVehicleRequest,
    context: RequestContext,
  ) {
    const rider = await this.resolveRider(userId);
    assertFutureExpiry(
      'Insurance expiry',
      input.insuranceExpiry,
      'RIDER_VEHICLE_INSURANCE_EXPIRED',
    );
    assertFutureExpiry('Permit expiry', input.permitExpiry, 'RIDER_VEHICLE_PERMIT_EXPIRED');

    if (input.registrationNumber) {
      await this.assertRegistrationAvailable(input.registrationNumber, vehicleId);
    }

    const vehicle = await this.options.repository.updateVehicle(
      rider.id,
      vehicleId,
      input as UpdateVehicleData,
    );

    if (!vehicle) {
      throw new AppError('Vehicle not found', 404, 'RIDER_VEHICLE_NOT_FOUND');
    }

    await this.invalidateVehicles(rider.id);
    await this.publish(KafkaTopics.RiderVehicleUpdated, vehicle.id, {
      riderId: rider.id,
      userId,
      vehicleId: vehicle.id,
      requestId: context.requestId,
      traceId: context.traceId,
      changedFields: Object.keys(input),
    });

    return validate(apiResponseSchema(vehicleSchema), { data: vehicle });
  }

  async deleteVehicle(userId: string, vehicleId: string, context: RequestContext) {
    const rider = await this.resolveRider(userId);
    const vehicle = await this.options.repository.deleteVehicle(rider.id, vehicleId);

    if (!vehicle) {
      throw new AppError('Vehicle not found', 404, 'RIDER_VEHICLE_NOT_FOUND');
    }

    await this.invalidateVehicles(rider.id);
    await this.recomputeOnboardingStatus(rider);
    await this.invalidateProfile(userId);
    await this.publish(KafkaTopics.RiderVehicleDeleted, vehicle.id, {
      riderId: rider.id,
      userId,
      vehicleId: vehicle.id,
      requestId: context.requestId,
      traceId: context.traceId,
    });

    return validate(messageResponseSchema, { data: { message: 'Vehicle deleted successfully' } });
  }

  async setPrimaryVehicle(userId: string, vehicleId: string, context: RequestContext) {
    const rider = await this.resolveRider(userId);
    const vehicle = await this.options.repository.setPrimaryVehicle(rider.id, vehicleId);

    if (!vehicle) {
      throw new AppError('Vehicle not found', 404, 'RIDER_VEHICLE_NOT_FOUND');
    }

    await this.invalidateVehicles(rider.id);
    await this.publish(KafkaTopics.RiderVehicleUpdated, vehicle.id, {
      riderId: rider.id,
      userId,
      vehicleId: vehicle.id,
      requestId: context.requestId,
      traceId: context.traceId,
      changedFields: ['isPrimary'],
    });

    return validate(apiResponseSchema(vehicleSchema), { data: vehicle });
  }

  async listDocuments(userId: string, pagination: PaginationQuery) {
    const rider = await this.resolveRider(userId);
    const documents = await this.options.repository.listDocuments(rider.id);

    return validate(
      collectionResponseSchema(riderDocumentSchema),
      paginateList(documents, pagination.limit, pagination.cursor),
    );
  }

  async uploadDocument(userId: string, input: DocumentUpload, context: RequestContext) {
    const rider = await this.resolveRider(userId);
    const existing = await this.options.repository.findActiveDocumentByType(
      rider.id,
      input.documentType,
    );

    if (existing) {
      throw new AppError(
        'An active document of this type already exists',
        409,
        'RIDER_DOCUMENT_DUPLICATE',
      );
    }

    const key = `riders/${rider.id}/documents/${input.documentType}/${randomUUID()}-${sanitizeFileName(
      input.fileName,
    )}`;
    const upload = await this.options.storageProvider.putObject({
      bucket: this.options.documentBucket,
      key,
      body: input.body,
      contentType: input.contentType,
      metadata: {
        riderId: rider.id,
        documentType: input.documentType,
      },
    });
    assertValidStorageUri(upload.uri);

    const document = await this.options.repository.createDocument(rider.id, {
      documentType: input.documentType,
      fileUrl: upload.uri,
    });

    await this.recomputeOnboardingStatus(rider);
    await this.invalidateProfile(userId);
    await this.publish(KafkaTopics.RiderDocumentUploaded, document.id, {
      riderId: rider.id,
      userId,
      documentId: document.id,
      documentType: document.documentType,
      requestId: context.requestId,
      traceId: context.traceId,
    });

    return validate(apiResponseSchema(riderDocumentSchema), { data: document });
  }

  async deleteDocument(userId: string, documentId: string, context: RequestContext) {
    const rider = await this.resolveRider(userId);
    const document = await this.options.repository.findDocument(rider.id, documentId);

    if (!document) {
      throw new AppError('Document not found', 404, 'RIDER_DOCUMENT_NOT_FOUND');
    }

    const parsed = parseObjectUri(document.fileUrl);
    if (parsed) {
      await this.options.storageProvider.deleteObject(parsed.bucket, parsed.key);
    }

    await this.options.repository.deleteDocument(rider.id, documentId);
    await this.recomputeOnboardingStatus(rider);
    await this.invalidateProfile(userId);
    await this.publish(KafkaTopics.RiderDocumentDeleted, document.id, {
      riderId: rider.id,
      userId,
      documentId: document.id,
      documentType: document.documentType,
      requestId: context.requestId,
      traceId: context.traceId,
    });

    return validate(messageResponseSchema, { data: { message: 'Document deleted successfully' } });
  }

  async getPreferences(userId: string) {
    const rider = await this.resolveRider(userId);
    const cacheKey = preferenceCacheKey(rider.id);
    const cached = await this.options.cache.getJson<RiderPreference>(cacheKey);

    if (cached) {
      return validate(apiResponseSchema(riderPreferenceSchema), {
        data: normalizePreferenceDates(cached),
      });
    }

    const preference = await this.options.repository.getOrCreatePreference(rider.id);
    await this.options.cache.setJson(cacheKey, preference, this.options.cacheTtlSeconds);

    return validate(apiResponseSchema(riderPreferenceSchema), { data: preference });
  }

  async updatePreferences(
    userId: string,
    input: UpdatePreferencesRequest,
    context: RequestContext,
  ) {
    const rider = await this.resolveRider(userId);

    if (input.preferredLanguage) {
      assertValidLanguageCode(input.preferredLanguage);
    }

    const preference = await this.options.repository.updatePreference(rider.id, input);

    await this.options.cache.delete([preferenceCacheKey(rider.id)]);
    await this.publish(KafkaTopics.RiderPreferencesUpdated, rider.id, {
      riderId: rider.id,
      userId,
      requestId: context.requestId,
      traceId: context.traceId,
      changedFields: Object.keys(input),
    });

    return validate(apiResponseSchema(riderPreferenceSchema), { data: preference });
  }

  private async resolveRider(userId: string): Promise<Rider> {
    const rider = await this.options.repository.findRiderByUserId(userId);

    if (!rider) {
      throw new AppError('Rider profile not found', 404, 'RIDER_NOT_FOUND');
    }

    return rider;
  }

  private async getOrCreateRider(userId: string): Promise<{ rider: Rider; created: boolean }> {
    const existing = await this.options.repository.findRiderByUserId(userId);

    if (existing) {
      return { rider: existing, created: false };
    }

    const rider = await this.options.repository.createRider(userId, {
      riderCode: generateRiderCode(),
    });

    return { rider, created: true };
  }

  private async getCachedVehicles(riderId: string): Promise<Vehicle[]> {
    const cacheKey = vehicleListCacheKey(riderId);
    const cached = await this.options.cache.getJson<Vehicle[]>(cacheKey);

    if (cached) {
      return cached.map(normalizeVehicleDates);
    }

    const vehicles = await this.options.repository.listVehicles(riderId);
    await this.options.cache.setJson(cacheKey, vehicles, this.options.cacheTtlSeconds);
    return vehicles;
  }

  private async recomputeOnboardingStatus(rider: Rider): Promise<Rider> {
    const [vehicleCount, documents] = await Promise.all([
      this.options.repository.countVehicles(rider.id),
      this.options.repository.listDocuments(rider.id),
    ]);

    const activeTypes = new Set(
      documents
        .filter((document) => document.verificationStatus !== 'REJECTED')
        .map((document) => document.documentType),
    );
    const hasRequiredDocuments = REQUIRED_DOCUMENT_TYPES.every((type) => activeTypes.has(type));
    const hasVehicle = vehicleCount > 0;

    let nextStatus: Rider['onboardingStatus'] = 'PENDING';
    if (hasVehicle && hasRequiredDocuments) {
      nextStatus = 'COMPLETED';
    } else if (hasVehicle || activeTypes.size > 0) {
      nextStatus = 'IN_PROGRESS';
    }

    if (nextStatus === rider.onboardingStatus) {
      return rider;
    }

    return this.options.repository.updateRider(rider.id, { onboardingStatus: nextStatus });
  }

  private async assertRegistrationAvailable(registrationNumber: string, excludeVehicleId?: string) {
    const existing = await this.options.repository.findVehicleByRegistration(registrationNumber);

    if (existing && existing.id !== excludeVehicleId) {
      throw new AppError(
        'A vehicle with this registration number already exists',
        409,
        'RIDER_VEHICLE_DUPLICATE',
      );
    }
  }

  private async invalidateProfile(userId: string) {
    await this.options.cache.delete([riderProfileCacheKey(userId)]);
  }

  private async invalidateVehicles(riderId: string) {
    await this.options.cache.delete([vehicleListCacheKey(riderId)]);
  }

  private async publish<TPayload extends Record<string, unknown>>(
    topic: RiderEventName,
    key: string,
    payload: TPayload,
  ) {
    await this.options.eventPublisher.publish(topic, key, payload);
  }
}

function toCreateVehicleData(input: CreateVehicleRequest): CreateVehicleData {
  return {
    vehicleType: input.vehicleType,
    brand: input.brand,
    model: input.model,
    color: input.color,
    registrationNumber: input.registrationNumber,
    registrationState: input.registrationState,
    manufacturingYear: input.manufacturingYear,
    insuranceExpiry: input.insuranceExpiry ?? null,
    permitExpiry: input.permitExpiry ?? null,
    isPrimary: input.isPrimary,
  };
}

function paginateList<T extends { id: string }>(items: T[], limit: number, cursor?: string) {
  const startIndex = cursor ? items.findIndex((item) => item.id === cursor) + 1 : 0;
  const page = items.slice(startIndex, startIndex + limit + 1);
  const hasMore = page.length > limit;
  const data = hasMore ? page.slice(0, limit) : page;
  const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

  return {
    data,
    meta: {
      pagination: {
        limit,
        nextCursor,
        hasMore,
      },
    },
  };
}

function generateRiderCode() {
  return `RDR-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

function normalizeRiderDates(rider: Rider): Rider {
  return {
    ...rider,
    createdAt: new Date(rider.createdAt),
    updatedAt: new Date(rider.updatedAt),
  };
}

function normalizeVehicleDates(vehicle: Vehicle): Vehicle {
  return {
    ...vehicle,
    insuranceExpiry: vehicle.insuranceExpiry ? new Date(vehicle.insuranceExpiry) : null,
    permitExpiry: vehicle.permitExpiry ? new Date(vehicle.permitExpiry) : null,
    createdAt: new Date(vehicle.createdAt),
    updatedAt: new Date(vehicle.updatedAt),
  };
}

function normalizePreferenceDates(preference: RiderPreference): RiderPreference {
  return {
    ...preference,
    createdAt: new Date(preference.createdAt),
    updatedAt: new Date(preference.updatedAt),
  };
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function parseObjectUri(uri: string) {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/]+)\/(.+)$/i.exec(uri);

  if (!match?.[2] || !match[3]) {
    return null;
  }

  return {
    bucket: match[2],
    key: match[3],
  };
}
