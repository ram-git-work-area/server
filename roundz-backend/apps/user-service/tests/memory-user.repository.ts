import { randomUUID } from 'node:crypto';
import type {
  Address,
  AddressLabel,
  FavoriteLocation,
  Gender,
  UserProfile,
  UserSettings,
} from '@prisma/client';
import type { ObjectStorageProvider, PutObjectInput } from '@roundz/cloud';
import type { UserEventName, UserEventPublisher } from '../src/events/user-events.publisher';
import type {
  CreateAddressData,
  CreateFavoriteLocationData,
  ProfileUpdateData,
  UpdateAddressData,
  UpdateFavoriteLocationData,
  UpdateSettingsData,
  UserRepositoryPort,
} from '../src/repositories/user.repository';
import { MemoryUserCache } from '../src/services/user-cache.service';

export class MemoryUserRepository implements UserRepositoryPort {
  public profiles: UserProfile[] = [];
  public addresses: Address[] = [];
  public favorites: FavoriteLocation[] = [];
  public settings: UserSettings[] = [];

  async findProfileByUserId(userId: string) {
    return this.profiles.find((profile) => profile.userId === userId) ?? null;
  }

  async upsertProfile(userId: string, data: ProfileUpdateData) {
    const existing = await this.findProfileByUserId(userId);
    const now = new Date();

    if (!existing) {
      const profile: UserProfile = {
        id: randomUUID(),
        userId,
        firstName: data.firstName ?? '',
        lastName: data.lastName ?? '',
        gender: (data.gender as Gender | null | undefined) ?? null,
        profileImageUrl: data.profileImageUrl ?? null,
        dateOfBirth: data.dateOfBirth ?? null,
        emergencyContactName: data.emergencyContactName ?? null,
        emergencyContactPhone: data.emergencyContactPhone ?? null,
        preferredLanguage: data.preferredLanguage ?? 'en',
        createdAt: now,
        updatedAt: now,
      };
      this.profiles.push(profile);
      return profile;
    }

    Object.assign(existing, data, { updatedAt: now });
    return existing;
  }

  async clearProfileImage(userId: string) {
    return this.upsertProfile(userId, { profileImageUrl: null });
  }

  async listAddresses(input: { userId: string; limit: number; cursor?: string }) {
    const sorted = this.addresses
      .filter((address) => address.userId === input.userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    const start = input.cursor
      ? Math.max(0, sorted.findIndex((address) => address.id === input.cursor) + 1)
      : 0;
    return sorted.slice(start, start + input.limit + 1);
  }

  async createAddress(userId: string, data: CreateAddressData) {
    const isDefault =
      data.isDefault || this.addresses.filter((address) => address.userId === userId).length === 0;

    if (isDefault) {
      this.addresses
        .filter((address) => address.userId === userId)
        .forEach((address) => {
          address.isDefault = false;
        });
    }

    const now = new Date();
    const address: Address = {
      id: randomUUID(),
      userId,
      label: data.label as AddressLabel,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2 ?? null,
      city: data.city,
      state: data.state,
      country: data.country,
      postalCode: data.postalCode,
      latitude: data.latitude,
      longitude: data.longitude,
      isDefault,
      createdAt: now,
      updatedAt: now,
    };
    this.addresses.push(address);
    return address;
  }

  async updateAddress(userId: string, addressId: string, data: UpdateAddressData) {
    const address = this.addresses.find((item) => item.userId === userId && item.id === addressId);

    if (!address) {
      return null;
    }

    if (data.isDefault) {
      this.addresses
        .filter((item) => item.userId === userId)
        .forEach((item) => {
          item.isDefault = false;
        });
    }

    Object.assign(address, data, { updatedAt: new Date() });
    return address;
  }

  async deleteAddress(userId: string, addressId: string) {
    const index = this.addresses.findIndex(
      (address) => address.userId === userId && address.id === addressId,
    );

    if (index < 0) {
      return null;
    }

    const [deleted] = this.addresses.splice(index, 1);
    return deleted ?? null;
  }

  async setDefaultAddress(userId: string, addressId: string) {
    const address = this.addresses.find((item) => item.userId === userId && item.id === addressId);

    if (!address) {
      return null;
    }

    this.addresses
      .filter((item) => item.userId === userId)
      .forEach((item) => {
        item.isDefault = false;
      });
    address.isDefault = true;
    address.updatedAt = new Date();
    return address;
  }

  async listFavoriteLocations(input: { userId: string; limit: number; cursor?: string }) {
    const sorted = this.favorites
      .filter((favorite) => favorite.userId === input.userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    const start = input.cursor
      ? Math.max(0, sorted.findIndex((favorite) => favorite.id === input.cursor) + 1)
      : 0;
    return sorted.slice(start, start + input.limit + 1);
  }

  async findFavoriteLocation(userId: string, favoriteId: string) {
    return (
      this.favorites.find((favorite) => favorite.userId === userId && favorite.id === favoriteId) ??
      null
    );
  }

  async createFavoriteLocation(userId: string, data: CreateFavoriteLocationData) {
    const favorite: FavoriteLocation = {
      id: randomUUID(),
      userId,
      name: data.name,
      address: data.address,
      latitude: data.latitude,
      longitude: data.longitude,
      createdAt: new Date(),
    };
    this.favorites.push(favorite);
    return favorite;
  }

  async updateFavoriteLocation(
    userId: string,
    favoriteId: string,
    data: UpdateFavoriteLocationData,
  ) {
    const favorite = await this.findFavoriteLocation(userId, favoriteId);

    if (!favorite) {
      return null;
    }

    Object.assign(favorite, data);
    return favorite;
  }

  async deleteFavoriteLocation(userId: string, favoriteId: string) {
    const index = this.favorites.findIndex(
      (favorite) => favorite.userId === userId && favorite.id === favoriteId,
    );

    if (index < 0) {
      return null;
    }

    const [deleted] = this.favorites.splice(index, 1);
    return deleted ?? null;
  }

  async findDuplicateFavorite(
    userId: string,
    data: CreateFavoriteLocationData,
    excludeFavoriteId?: string,
  ) {
    return (
      this.favorites.find(
        (favorite) =>
          favorite.userId === userId &&
          favorite.name === data.name &&
          favorite.address === data.address &&
          favorite.id !== excludeFavoriteId,
      ) ?? null
    );
  }

  async getOrCreateSettings(userId: string) {
    const existing = this.settings.find((settings) => settings.userId === userId);

    if (existing) {
      return existing;
    }

    const now = new Date();
    const settings: UserSettings = {
      id: randomUUID(),
      userId,
      pushNotificationsEnabled: true,
      marketingNotificationsEnabled: false,
      emailNotificationsEnabled: true,
      darkModeEnabled: false,
      language: 'en',
      timezone: 'UTC',
      createdAt: now,
      updatedAt: now,
    };
    this.settings.push(settings);
    return settings;
  }

  async updateSettings(userId: string, data: UpdateSettingsData) {
    const settings = await this.getOrCreateSettings(userId);
    Object.assign(settings, data, { updatedAt: new Date() });
    return settings;
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

export class MemoryUserEventPublisher implements UserEventPublisher {
  public events: Array<{ topic: UserEventName; key: string; payload: Record<string, unknown> }> =
    [];

  async publish<TPayload extends Record<string, unknown>>(
    topic: UserEventName,
    key: string,
    payload: TPayload,
  ) {
    this.events.push({ topic, key, payload });
  }
}

export { MemoryUserCache };
