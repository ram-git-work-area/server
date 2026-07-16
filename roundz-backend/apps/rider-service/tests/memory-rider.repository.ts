import { randomUUID } from 'node:crypto';
import type {
  Rider,
  RiderDocument,
  RiderDocumentType,
  RiderPreference,
  Vehicle,
} from '@prisma/client';
import type { ObjectStorageProvider, PutObjectInput } from '@roundz/cloud';
import type { RiderEventName, RiderEventPublisher } from '../src/events/rider-events.publisher';
import type {
  CreateDocumentData,
  CreateRiderData,
  CreateVehicleData,
  RiderRepositoryPort,
  UpdatePreferenceData,
  UpdateRiderData,
  UpdateVehicleData,
} from '../src/repositories/rider.repository';
import { MemoryRiderCache } from '../src/services/rider-cache.service';

export class MemoryRiderRepository implements RiderRepositoryPort {
  public riders: Rider[] = [];
  public vehicles: Vehicle[] = [];
  public documents: RiderDocument[] = [];
  public preferences: RiderPreference[] = [];

  async findRiderByUserId(userId: string) {
    return this.riders.find((rider) => rider.userId === userId) ?? null;
  }

  async createRider(userId: string, data: CreateRiderData) {
    const now = new Date();
    const rider: Rider = {
      id: randomUUID(),
      userId,
      riderCode: data.riderCode,
      status: 'ACTIVE',
      onboardingStatus: 'PENDING',
      approvalStatus: 'PENDING',
      onlineStatus: 'OFFLINE',
      profilePhoto: data.profilePhoto ?? null,
      rating: 0,
      totalTrips: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.riders.push(rider);
    return rider;
  }

  async updateRider(riderId: string, data: UpdateRiderData) {
    const rider = this.riders.find((item) => item.id === riderId);

    if (!rider) {
      throw new Error(`Rider not found: ${riderId}`);
    }

    Object.assign(rider, data, { updatedAt: new Date() });
    return rider;
  }

  async listVehicles(riderId: string) {
    return this.vehicles
      .filter((vehicle) => vehicle.riderId === riderId)
      .sort(
        (a, b) =>
          Number(b.isPrimary) - Number(a.isPrimary) ||
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id.localeCompare(a.id),
      );
  }

  async findVehicle(riderId: string, vehicleId: string) {
    return (
      this.vehicles.find((vehicle) => vehicle.riderId === riderId && vehicle.id === vehicleId) ??
      null
    );
  }

  async findVehicleByRegistration(registrationNumber: string) {
    return (
      this.vehicles.find((vehicle) => vehicle.registrationNumber === registrationNumber) ?? null
    );
  }

  async countVehicles(riderId: string) {
    return this.vehicles.filter((vehicle) => vehicle.riderId === riderId).length;
  }

  async createVehicle(riderId: string, data: CreateVehicleData) {
    const existingCount = await this.countVehicles(riderId);
    const isPrimary = data.isPrimary || existingCount === 0;

    if (isPrimary) {
      this.unsetPrimary(riderId);
    }

    const now = new Date();
    const vehicle: Vehicle = {
      id: randomUUID(),
      riderId,
      vehicleType: data.vehicleType,
      brand: data.brand,
      model: data.model,
      color: data.color,
      registrationNumber: data.registrationNumber,
      registrationState: data.registrationState,
      manufacturingYear: data.manufacturingYear,
      insuranceExpiry: data.insuranceExpiry ?? null,
      permitExpiry: data.permitExpiry ?? null,
      isPrimary,
      createdAt: now,
      updatedAt: now,
    };
    this.vehicles.push(vehicle);
    return vehicle;
  }

  async updateVehicle(riderId: string, vehicleId: string, data: UpdateVehicleData) {
    const vehicle = await this.findVehicle(riderId, vehicleId);

    if (!vehicle) {
      return null;
    }

    if (data.isPrimary) {
      this.unsetPrimary(riderId);
    }

    Object.assign(vehicle, data, { updatedAt: new Date() });
    return vehicle;
  }

  async deleteVehicle(riderId: string, vehicleId: string) {
    const index = this.vehicles.findIndex(
      (vehicle) => vehicle.riderId === riderId && vehicle.id === vehicleId,
    );

    if (index < 0) {
      return null;
    }

    const [deleted] = this.vehicles.splice(index, 1);

    if (deleted?.isPrimary) {
      const next = await this.listVehicles(riderId);
      if (next[0]) {
        next[0].isPrimary = true;
      }
    }

    return deleted ?? null;
  }

  async setPrimaryVehicle(riderId: string, vehicleId: string) {
    const vehicle = await this.findVehicle(riderId, vehicleId);

    if (!vehicle) {
      return null;
    }

    this.unsetPrimary(riderId);
    vehicle.isPrimary = true;
    vehicle.updatedAt = new Date();
    return vehicle;
  }

  async listDocuments(riderId: string) {
    return this.documents
      .filter((document) => document.riderId === riderId)
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime() || b.id.localeCompare(a.id));
  }

  async findDocument(riderId: string, documentId: string) {
    return (
      this.documents.find(
        (document) => document.riderId === riderId && document.id === documentId,
      ) ?? null
    );
  }

  async findActiveDocumentByType(riderId: string, documentType: RiderDocumentType) {
    return (
      this.documents.find(
        (document) =>
          document.riderId === riderId &&
          document.documentType === documentType &&
          document.verificationStatus !== 'REJECTED',
      ) ?? null
    );
  }

  async createDocument(riderId: string, data: CreateDocumentData) {
    const document: RiderDocument = {
      id: randomUUID(),
      riderId,
      documentType: data.documentType,
      fileUrl: data.fileUrl,
      verificationStatus: data.verificationStatus ?? 'PENDING',
      rejectionReason: null,
      uploadedAt: new Date(),
      verifiedAt: null,
    };
    this.documents.push(document);
    return document;
  }

  async deleteDocument(riderId: string, documentId: string) {
    const index = this.documents.findIndex(
      (document) => document.riderId === riderId && document.id === documentId,
    );

    if (index < 0) {
      return null;
    }

    const [deleted] = this.documents.splice(index, 1);
    return deleted ?? null;
  }

  async getOrCreatePreference(riderId: string) {
    const existing = this.preferences.find((preference) => preference.riderId === riderId);

    if (existing) {
      return existing;
    }

    const now = new Date();
    const preference: RiderPreference = {
      id: randomUUID(),
      riderId,
      preferredLanguage: 'en',
      autoAcceptTrips: false,
      receivePromotions: true,
      createdAt: now,
      updatedAt: now,
    };
    this.preferences.push(preference);
    return preference;
  }

  async updatePreference(riderId: string, data: UpdatePreferenceData) {
    const preference = await this.getOrCreatePreference(riderId);
    Object.assign(preference, data, { updatedAt: new Date() });
    return preference;
  }

  private unsetPrimary(riderId: string) {
    this.vehicles
      .filter((vehicle) => vehicle.riderId === riderId)
      .forEach((vehicle) => {
        vehicle.isPrimary = false;
      });
  }
}

export class MemoryObjectStorageProvider implements ObjectStorageProvider {
  public putObjects: PutObjectInput[] = [];
  public deletedObjects: Array<{ bucket: string; key: string }> = [];

  async putObject(input: PutObjectInput) {
    this.putObjects.push(input);
    return { uri: `local://${input.bucket}/${input.key}` };
  }

  async getSignedReadUrl(bucket: string, key: string) {
    return `local://${bucket}/${key}?signed=true`;
  }

  async deleteObject(bucket: string, key: string) {
    this.deletedObjects.push({ bucket, key });
  }
}

export class MemoryRiderEventPublisher implements RiderEventPublisher {
  public events: Array<{ topic: RiderEventName; key: string; payload: Record<string, unknown> }> =
    [];

  async publish<TPayload extends Record<string, unknown>>(
    topic: RiderEventName,
    key: string,
    payload: TPayload,
  ) {
    this.events.push({ topic, key, payload });
  }
}

export { MemoryRiderCache };
