import { randomUUID } from 'node:crypto';
import type {
  Address,
  AddressLabel,
  FavoriteLocation,
  Gender,
  UserProfile,
  UserSettings,
} from '@prisma/client';
import type { ObjectStorageProvider } from '@roundz/cloud';
import { AppError } from '@roundz/errors';
import { KafkaTopics } from '@roundz/kafka';
import { validate } from '@roundz/validation';
import type { UserEventPublisher } from '../events/user-events.publisher';
import type { UserRepositoryPort } from '../repositories/user.repository';
import {
  addressSchema,
  apiResponseSchema,
  collectionResponseSchema,
  favoriteLocationSchema,
  messageResponseSchema,
  userProfileSchema,
  userSettingsSchema,
  type CreateAddressRequest,
  type CreateFavoriteLocationRequest,
  type PaginationQuery,
  type ProfileImageUpload,
  type UpdateAddressRequest,
  type UpdateEmergencyContactRequest,
  type UpdateFavoriteLocationRequest,
  type UpdateProfileRequest,
  type UpdateSettingsRequest,
} from '../schemas/user.schemas';
import { profileCacheKey, settingsCacheKey, type UserCache } from './user-cache.service';
import {
  assertValidCoordinates,
  assertValidImageUrl,
  assertValidLanguageCode,
  assertValidTimezone,
} from '../validators/user.validators';

export type RequestContext = {
  requestId: string;
  traceId?: string;
};

export type UserServiceOptions = {
  repository: UserRepositoryPort;
  cache: UserCache;
  eventPublisher: UserEventPublisher;
  storageProvider: ObjectStorageProvider;
  profileImageBucket: string;
  cacheTtlSeconds: number;
};

export class UserService {
  constructor(private readonly options: UserServiceOptions) {}

  async getProfile(userId: string) {
    const cacheKey = profileCacheKey(userId);
    const cached = await this.options.cache.getJson<UserProfile>(cacheKey);

    if (cached) {
      return validate(apiResponseSchema(userProfileSchema.nullable()), {
        data: normalizeProfileDates(cached),
      });
    }

    const profile = await this.options.repository.findProfileByUserId(userId);
    const data = profile ? toProfileDto(profile) : null;

    if (data) {
      await this.options.cache.setJson(cacheKey, data, this.options.cacheTtlSeconds);
    }

    return validate(apiResponseSchema(userProfileSchema.nullable()), { data });
  }

  async updateProfile(userId: string, input: UpdateProfileRequest, context: RequestContext) {
    if (input.preferredLanguage) {
      assertValidLanguageCode(input.preferredLanguage);
    }
    assertValidImageUrl(input.profileImageUrl);

    const profile = await this.options.repository.upsertProfile(userId, {
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender as Gender | null | undefined,
      profileImageUrl: input.profileImageUrl,
      dateOfBirth: input.dateOfBirth,
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: input.emergencyContactPhone,
      preferredLanguage: input.preferredLanguage,
    });

    await this.invalidateProfile(userId);
    await this.publish(KafkaTopics.UserProfileUpdated, userId, {
      userId,
      requestId: context.requestId,
      traceId: context.traceId,
      changedFields: Object.keys(input),
    });

    return validate(apiResponseSchema(userProfileSchema), { data: toProfileDto(profile) });
  }

  async uploadProfileImage(userId: string, input: ProfileImageUpload, context: RequestContext) {
    const key = `users/${userId}/profile-images/${randomUUID()}-${sanitizeFileName(input.fileName)}`;
    const upload = await this.options.storageProvider.putObject({
      bucket: this.options.profileImageBucket,
      key,
      body: input.body,
      contentType: input.contentType,
      metadata: {
        userId,
        purpose: 'profile-image',
      },
    });
    assertValidImageUrl(upload.uri);

    const profile = await this.options.repository.upsertProfile(userId, {
      profileImageUrl: upload.uri,
    });

    await this.invalidateProfile(userId);
    await this.publish(KafkaTopics.UserProfileUpdated, userId, {
      userId,
      requestId: context.requestId,
      traceId: context.traceId,
      changedFields: ['profileImageUrl'],
    });

    return validate(apiResponseSchema(userProfileSchema), { data: toProfileDto(profile) });
  }

  async deleteProfileImage(userId: string, context: RequestContext) {
    const current = await this.options.repository.findProfileByUserId(userId);

    if (current?.profileImageUrl) {
      const parsed = parseObjectUri(current.profileImageUrl);
      if (parsed) {
        await this.options.storageProvider.deleteObject(parsed.bucket, parsed.key);
      }
    }

    const profile = await this.options.repository.clearProfileImage(userId);
    await this.invalidateProfile(userId);
    await this.publish(KafkaTopics.UserProfileUpdated, userId, {
      userId,
      requestId: context.requestId,
      traceId: context.traceId,
      changedFields: ['profileImageUrl'],
    });

    return validate(apiResponseSchema(userProfileSchema), { data: toProfileDto(profile) });
  }

  async listAddresses(userId: string, pagination: PaginationQuery) {
    const addresses = await this.options.repository.listAddresses({
      userId,
      limit: pagination.limit,
      cursor: pagination.cursor,
    });

    return validate(
      collectionResponseSchema(addressSchema),
      toCursorResponse(addresses.map(toAddressDto), pagination.limit),
    );
  }

  async createAddress(userId: string, input: CreateAddressRequest, context: RequestContext) {
    assertValidCoordinates(input.latitude, input.longitude);
    const address = await this.options.repository.createAddress(userId, {
      ...input,
      label: input.label as AddressLabel,
      addressLine2: input.addressLine2 ?? null,
    });

    await this.publish(KafkaTopics.UserAddressCreated, address.id, {
      userId,
      addressId: address.id,
      requestId: context.requestId,
      traceId: context.traceId,
    });

    return validate(apiResponseSchema(addressSchema), { data: toAddressDto(address) });
  }

  async updateAddress(
    userId: string,
    addressId: string,
    input: UpdateAddressRequest,
    context: RequestContext,
  ) {
    assertCoordinateUpdate(input.latitude, input.longitude);

    const address = await this.options.repository.updateAddress(userId, addressId, {
      ...input,
      label: input.label as AddressLabel | undefined,
      addressLine2: input.addressLine2 ?? undefined,
    });

    if (!address) {
      throw new AppError('Address not found', 404, 'USER_ADDRESS_NOT_FOUND');
    }

    await this.publish(KafkaTopics.UserAddressUpdated, address.id, {
      userId,
      addressId: address.id,
      requestId: context.requestId,
      traceId: context.traceId,
      changedFields: Object.keys(input),
    });

    return validate(apiResponseSchema(addressSchema), { data: toAddressDto(address) });
  }

  async deleteAddress(userId: string, addressId: string, context: RequestContext) {
    const address = await this.options.repository.deleteAddress(userId, addressId);

    if (!address) {
      throw new AppError('Address not found', 404, 'USER_ADDRESS_NOT_FOUND');
    }

    await this.publish(KafkaTopics.UserAddressDeleted, address.id, {
      userId,
      addressId: address.id,
      requestId: context.requestId,
      traceId: context.traceId,
    });

    return validate(messageResponseSchema, { data: { message: 'Address deleted successfully' } });
  }

  async setDefaultAddress(userId: string, addressId: string, context: RequestContext) {
    const address = await this.options.repository.setDefaultAddress(userId, addressId);

    if (!address) {
      throw new AppError('Address not found', 404, 'USER_ADDRESS_NOT_FOUND');
    }

    await this.publish(KafkaTopics.UserAddressUpdated, address.id, {
      userId,
      addressId: address.id,
      requestId: context.requestId,
      traceId: context.traceId,
      changedFields: ['isDefault'],
    });

    return validate(apiResponseSchema(addressSchema), { data: toAddressDto(address) });
  }

  async listFavoriteLocations(userId: string, pagination: PaginationQuery) {
    const favorites = await this.options.repository.listFavoriteLocations({
      userId,
      limit: pagination.limit,
      cursor: pagination.cursor,
    });

    return validate(
      collectionResponseSchema(favoriteLocationSchema),
      toCursorResponse(favorites.map(toFavoriteDto), pagination.limit),
    );
  }

  async createFavoriteLocation(
    userId: string,
    input: CreateFavoriteLocationRequest,
    context: RequestContext,
  ) {
    assertValidCoordinates(input.latitude, input.longitude);
    await this.assertFavoriteNotDuplicate(userId, input);

    const favorite = await this.options.repository.createFavoriteLocation(userId, input);

    await this.publish(KafkaTopics.UserFavoriteCreated, favorite.id, {
      userId,
      favoriteId: favorite.id,
      requestId: context.requestId,
      traceId: context.traceId,
    });

    return validate(apiResponseSchema(favoriteLocationSchema), { data: toFavoriteDto(favorite) });
  }

  async updateFavoriteLocation(
    userId: string,
    favoriteId: string,
    input: UpdateFavoriteLocationRequest,
    context: RequestContext,
  ) {
    assertCoordinateUpdate(input.latitude, input.longitude);
    const existing = await this.options.repository.findFavoriteLocation(userId, favoriteId);

    if (!existing) {
      throw new AppError('Favorite location not found', 404, 'USER_FAVORITE_NOT_FOUND');
    }

    const candidate = {
      name: input.name ?? existing.name,
      address: input.address ?? existing.address,
      latitude: input.latitude ?? existing.latitude,
      longitude: input.longitude ?? existing.longitude,
    };
    await this.assertFavoriteNotDuplicate(userId, candidate, favoriteId);
    const favorite = await this.options.repository.updateFavoriteLocation(
      userId,
      favoriteId,
      input,
    );

    if (!favorite) {
      throw new AppError('Favorite location not found', 404, 'USER_FAVORITE_NOT_FOUND');
    }

    await this.publish(KafkaTopics.UserFavoriteUpdated, favorite.id, {
      userId,
      favoriteId: favorite.id,
      requestId: context.requestId,
      traceId: context.traceId,
      changedFields: Object.keys(input),
    });

    return validate(apiResponseSchema(favoriteLocationSchema), { data: toFavoriteDto(favorite) });
  }

  async deleteFavoriteLocation(userId: string, favoriteId: string, context: RequestContext) {
    const favorite = await this.options.repository.deleteFavoriteLocation(userId, favoriteId);

    if (!favorite) {
      throw new AppError('Favorite location not found', 404, 'USER_FAVORITE_NOT_FOUND');
    }

    await this.publish(KafkaTopics.UserFavoriteDeleted, favorite.id, {
      userId,
      favoriteId: favorite.id,
      requestId: context.requestId,
      traceId: context.traceId,
    });

    return validate(messageResponseSchema, {
      data: { message: 'Favorite location deleted successfully' },
    });
  }

  async getSettings(userId: string) {
    const cacheKey = settingsCacheKey(userId);
    const cached = await this.options.cache.getJson<UserSettings>(cacheKey);

    if (cached) {
      return validate(apiResponseSchema(userSettingsSchema), {
        data: normalizeSettingsDates(cached),
      });
    }

    const settings = await this.options.repository.getOrCreateSettings(userId);
    const data = toSettingsDto(settings);
    await this.options.cache.setJson(cacheKey, data, this.options.cacheTtlSeconds);

    return validate(apiResponseSchema(userSettingsSchema), { data });
  }

  async updateSettings(userId: string, input: UpdateSettingsRequest, context: RequestContext) {
    if (input.language) {
      assertValidLanguageCode(input.language);
    }
    if (input.timezone) {
      assertValidTimezone(input.timezone);
    }

    const settings = await this.options.repository.updateSettings(userId, input);

    await this.invalidateSettings(userId);
    await this.publish(KafkaTopics.UserSettingsUpdated, userId, {
      userId,
      requestId: context.requestId,
      traceId: context.traceId,
      changedFields: Object.keys(input),
    });

    return validate(apiResponseSchema(userSettingsSchema), { data: toSettingsDto(settings) });
  }

  async updateEmergencyContact(
    userId: string,
    input: UpdateEmergencyContactRequest,
    context: RequestContext,
  ) {
    const profile = await this.options.repository.upsertProfile(userId, input);

    await this.invalidateProfile(userId);
    await this.publish(KafkaTopics.UserProfileUpdated, userId, {
      userId,
      requestId: context.requestId,
      traceId: context.traceId,
      changedFields: ['emergencyContactName', 'emergencyContactPhone'],
    });

    return validate(apiResponseSchema(userProfileSchema), { data: toProfileDto(profile) });
  }

  private async assertFavoriteNotDuplicate(
    userId: string,
    input: CreateFavoriteLocationRequest,
    excludeFavoriteId?: string,
  ) {
    const duplicate = await this.options.repository.findDuplicateFavorite(
      userId,
      input,
      excludeFavoriteId,
    );

    if (duplicate) {
      throw new AppError('Favorite location already exists', 409, 'USER_FAVORITE_DUPLICATE');
    }
  }

  private async invalidateProfile(userId: string) {
    await this.options.cache.delete([profileCacheKey(userId)]);
  }

  private async invalidateSettings(userId: string) {
    await this.options.cache.delete([settingsCacheKey(userId)]);
  }

  private async publish<TPayload extends Record<string, unknown>>(
    topic:
      | typeof KafkaTopics.UserProfileUpdated
      | typeof KafkaTopics.UserAddressCreated
      | typeof KafkaTopics.UserAddressUpdated
      | typeof KafkaTopics.UserAddressDeleted
      | typeof KafkaTopics.UserFavoriteCreated
      | typeof KafkaTopics.UserFavoriteUpdated
      | typeof KafkaTopics.UserFavoriteDeleted
      | typeof KafkaTopics.UserSettingsUpdated,
    key: string,
    payload: TPayload,
  ) {
    await this.options.eventPublisher.publish(topic, key, payload);
  }
}

function toCursorResponse<T extends { id: string }>(items: T[], limit: number) {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
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

function toProfileDto(profile: UserProfile): UserProfile {
  return profile;
}

function toAddressDto(address: Address): Address {
  return address;
}

function toFavoriteDto(favorite: FavoriteLocation): FavoriteLocation {
  return favorite;
}

function toSettingsDto(settings: UserSettings): UserSettings {
  return settings;
}

function normalizeProfileDates(profile: UserProfile): UserProfile {
  return {
    ...profile,
    dateOfBirth: profile.dateOfBirth ? new Date(profile.dateOfBirth) : null,
    createdAt: new Date(profile.createdAt),
    updatedAt: new Date(profile.updatedAt),
  };
}

function normalizeSettingsDates(settings: UserSettings): UserSettings {
  return {
    ...settings,
    createdAt: new Date(settings.createdAt),
    updatedAt: new Date(settings.updatedAt),
  };
}

function assertCoordinateUpdate(latitude?: number, longitude?: number) {
  if ((latitude === undefined) !== (longitude === undefined)) {
    throw new AppError(
      'Latitude and longitude must be updated together',
      400,
      'USER_COORDINATES_INCOMPLETE',
    );
  }

  if (latitude !== undefined && longitude !== undefined) {
    assertValidCoordinates(latitude, longitude);
  }
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function parseObjectUri(uri: string) {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/]+)\/(.+)$/i.exec(uri);

  if (!match) {
    return null;
  }

  return {
    bucket: match[2],
    key: match[3],
  };
}
