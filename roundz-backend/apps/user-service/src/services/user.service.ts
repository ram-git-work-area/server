import { randomUUID } from 'node:crypto';
import type { Address, AddressLabel, FavoriteLocation, Gender, UserProfile } from '@prisma/client';
import type { ObjectStorageProvider } from '@roundz/cloud';
import { AppError } from '@roundz/errors';
import { KafkaTopics } from '@roundz/kafka';
import { validate } from '@roundz/validation';
import type { UserRepositoryPort } from '../repositories/user.repository';
import {
  addressSchema,
  apiResponseSchema,
  favoriteLocationSchema,
  messageResponseSchema,
  paginatedResponseSchema,
  userProfileSchema,
  type AddressDto,
  type CreateAddressRequest,
  type CreateFavoriteLocationRequest,
  type FavoriteLocationDto,
  type PaginationQuery,
  type ProfileImageUpload,
  type UpdateAddressRequest,
  type UpdatePreferredLanguageRequest,
  type UpdateProfileRequest,
  type UserProfileDto,
} from '../schemas/user.schemas';
import type { UserEventPublisher } from './user-events.publisher';

export type RequestContext = {
  requestId: string;
};

export type ApiResponse<T> = {
  data: T;
};

export type PaginatedApiResponse<T> = {
  data: T[];
  meta: {
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
};

export type UserServiceOptions = {
  repository: UserRepositoryPort;
  storageProvider: ObjectStorageProvider;
  eventPublisher: UserEventPublisher;
  profileImageBucket: string;
};

export class UserService {
  constructor(private readonly options: UserServiceOptions) {}

  async getProfile(userId: string): Promise<ApiResponse<UserProfileDto | null>> {
    const profile = await this.options.repository.findProfileByUserId(userId);

    return validate(apiResponseSchema(userProfileSchema.nullable()), {
      data: profile ? toProfileDto(profile) : null,
    });
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileRequest,
    context: RequestContext,
  ): Promise<ApiResponse<UserProfileDto>> {
    const profile = await this.options.repository.upsertProfile(userId, {
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender as Gender | null | undefined,
      dateOfBirth: input.dateOfBirth,
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: input.emergencyContactPhone,
    });

    await this.publish(KafkaTopics.UserProfileUpdated, userId, {
      userId,
      requestId: context.requestId,
      changedFields: Object.keys(input),
    });

    return validate(apiResponseSchema(userProfileSchema), {
      data: toProfileDto(profile),
    });
  }

  async uploadProfileImage(
    userId: string,
    input: ProfileImageUpload,
    context: RequestContext,
  ): Promise<ApiResponse<UserProfileDto>> {
    const objectKey = `users/${userId}/profile-images/${randomUUID()}-${sanitizeFileName(
      input.fileName,
    )}`;
    const uploadResult = await this.options.storageProvider.putObject({
      bucket: this.options.profileImageBucket,
      key: objectKey,
      body: input.body,
      contentType: input.contentType,
      metadata: {
        userId,
        purpose: 'profile-image',
      },
    });
    const profile = await this.options.repository.updateProfileImage(userId, uploadResult.uri);

    await this.publish(KafkaTopics.UserProfileUpdated, userId, {
      userId,
      requestId: context.requestId,
      changedFields: ['profileImageUrl'],
    });

    return validate(apiResponseSchema(userProfileSchema), {
      data: toProfileDto(profile),
    });
  }

  async listAddresses(
    userId: string,
    pagination: PaginationQuery,
  ): Promise<PaginatedApiResponse<AddressDto>> {
    const result = await this.options.repository.listAddresses({
      userId,
      page: pagination.page,
      limit: pagination.limit,
    });

    return validate(
      paginatedResponseSchema(addressSchema),
      toPaginatedResponse(result.items.map(toAddressDto), result.total, pagination),
    );
  }

  async createAddress(
    userId: string,
    input: CreateAddressRequest,
    context: RequestContext,
  ): Promise<ApiResponse<AddressDto>> {
    const address = await this.options.repository.createAddress(userId, {
      ...input,
      label: input.label as AddressLabel,
    });

    await this.publish(KafkaTopics.UserAddressCreated, address.id, {
      userId,
      addressId: address.id,
      requestId: context.requestId,
    });

    return validate(apiResponseSchema(addressSchema), {
      data: toAddressDto(address),
    });
  }

  async updateAddress(
    userId: string,
    addressId: string,
    input: UpdateAddressRequest,
    context: RequestContext,
  ): Promise<ApiResponse<AddressDto>> {
    const address = await this.options.repository.updateAddress(userId, addressId, {
      ...input,
      label: input.label as AddressLabel | undefined,
    });

    if (!address) {
      throw new AppError('Address not found', 404, 'USER_ADDRESS_NOT_FOUND');
    }

    await this.publish(KafkaTopics.UserAddressUpdated, address.id, {
      userId,
      addressId: address.id,
      requestId: context.requestId,
      changedFields: Object.keys(input),
    });

    return validate(apiResponseSchema(addressSchema), {
      data: toAddressDto(address),
    });
  }

  async deleteAddress(
    userId: string,
    addressId: string,
    context: RequestContext,
  ): Promise<ApiResponse<{ message: string }>> {
    const address = await this.options.repository.deleteAddress(userId, addressId);

    if (!address) {
      throw new AppError('Address not found', 404, 'USER_ADDRESS_NOT_FOUND');
    }

    await this.publish(KafkaTopics.UserAddressDeleted, address.id, {
      userId,
      addressId: address.id,
      requestId: context.requestId,
    });

    return validate(messageResponseSchema, {
      data: { message: 'Address deleted successfully' },
    });
  }

  async setDefaultAddress(
    userId: string,
    addressId: string,
    context: RequestContext,
  ): Promise<ApiResponse<AddressDto>> {
    const address = await this.options.repository.setDefaultAddress(userId, addressId);

    if (!address) {
      throw new AppError('Address not found', 404, 'USER_ADDRESS_NOT_FOUND');
    }

    await this.publish(KafkaTopics.UserAddressUpdated, address.id, {
      userId,
      addressId: address.id,
      requestId: context.requestId,
      changedFields: ['isDefault'],
    });

    return validate(apiResponseSchema(addressSchema), {
      data: toAddressDto(address),
    });
  }

  async listFavoriteLocations(
    userId: string,
    pagination: PaginationQuery,
  ): Promise<PaginatedApiResponse<FavoriteLocationDto>> {
    const result = await this.options.repository.listFavoriteLocations({
      userId,
      page: pagination.page,
      limit: pagination.limit,
    });

    return validate(
      paginatedResponseSchema(favoriteLocationSchema),
      toPaginatedResponse(result.items.map(toFavoriteLocationDto), result.total, pagination),
    );
  }

  async createFavoriteLocation(
    userId: string,
    input: CreateFavoriteLocationRequest,
    context: RequestContext,
  ): Promise<ApiResponse<FavoriteLocationDto>> {
    const favorite = await this.options.repository.createFavoriteLocation(userId, input);

    await this.publish(KafkaTopics.UserFavoriteCreated, favorite.id, {
      userId,
      favoriteId: favorite.id,
      requestId: context.requestId,
    });

    return validate(apiResponseSchema(favoriteLocationSchema), {
      data: toFavoriteLocationDto(favorite),
    });
  }

  async deleteFavoriteLocation(
    userId: string,
    favoriteId: string,
    context: RequestContext,
  ): Promise<ApiResponse<{ message: string }>> {
    const favorite = await this.options.repository.deleteFavoriteLocation(userId, favoriteId);

    if (!favorite) {
      throw new AppError('Favorite location not found', 404, 'USER_FAVORITE_NOT_FOUND');
    }

    await this.publish(KafkaTopics.UserFavoriteDeleted, favorite.id, {
      userId,
      favoriteId: favorite.id,
      requestId: context.requestId,
    });

    return validate(messageResponseSchema, {
      data: { message: 'Favorite location deleted successfully' },
    });
  }

  async updatePreferredLanguage(
    userId: string,
    input: UpdatePreferredLanguageRequest,
    context: RequestContext,
  ): Promise<ApiResponse<UserProfileDto>> {
    const profile = await this.options.repository.updatePreferredLanguage(
      userId,
      input.preferredLanguage,
    );

    await this.publish(KafkaTopics.UserProfileUpdated, userId, {
      userId,
      requestId: context.requestId,
      changedFields: ['preferredLanguage'],
    });

    return validate(apiResponseSchema(userProfileSchema), {
      data: toProfileDto(profile),
    });
  }

  private async publish<TPayload extends Record<string, unknown>>(
    topic:
      | typeof KafkaTopics.UserProfileUpdated
      | typeof KafkaTopics.UserAddressCreated
      | typeof KafkaTopics.UserAddressUpdated
      | typeof KafkaTopics.UserAddressDeleted
      | typeof KafkaTopics.UserFavoriteCreated
      | typeof KafkaTopics.UserFavoriteDeleted,
    key: string,
    payload: TPayload,
  ) {
    await this.options.eventPublisher.publish(topic, key, payload);
  }
}

function toProfileDto(profile: UserProfile): UserProfileDto {
  return profile;
}

function toAddressDto(address: Address): AddressDto {
  return address;
}

function toFavoriteLocationDto(favoriteLocation: FavoriteLocation): FavoriteLocationDto {
  return favoriteLocation;
}

function toPaginatedResponse<T>(items: T[], total: number, pagination: PaginationQuery) {
  return {
    data: items,
    meta: {
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    },
  };
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
}
