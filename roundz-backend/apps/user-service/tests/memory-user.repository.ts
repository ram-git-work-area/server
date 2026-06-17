import { randomUUID } from 'node:crypto';
import type { Address, AddressLabel, FavoriteLocation, Gender, UserProfile } from '@prisma/client';
import type { ObjectStorageProvider, PutObjectInput } from '@roundz/cloud';
import type {
  CreateAddressData,
  CreateFavoriteLocationData,
  ProfileUpdateData,
  UpdateAddressData,
  UserRepositoryPort,
} from '../src/repositories/user.repository';
import type { UserEventName, UserEventPublisher } from '../src/services/user-events.publisher';

export class MemoryUserRepository implements UserRepositoryPort {
  public profiles: UserProfile[] = [];
  public addresses: Address[] = [];
  public favorites: FavoriteLocation[] = [];

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
        profileImageUrl: null,
        dateOfBirth: data.dateOfBirth ?? null,
        emergencyContactName: data.emergencyContactName ?? null,
        emergencyContactPhone: data.emergencyContactPhone ?? null,
        preferredLanguage: 'en',
        createdAt: now,
        updatedAt: now,
      };

      this.profiles.push(profile);
      return profile;
    }

    Object.assign(existing, data, { updatedAt: now });
    return existing;
  }

  async updateProfileImage(userId: string, profileImageUrl: string) {
    const existing = await this.findProfileByUserId(userId);
    const now = new Date();

    if (!existing) {
      const profile: UserProfile = {
        id: randomUUID(),
        userId,
        firstName: '',
        lastName: '',
        gender: null,
        profileImageUrl,
        dateOfBirth: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        preferredLanguage: 'en',
        createdAt: now,
        updatedAt: now,
      };
      this.profiles.push(profile);
      return profile;
    }

    existing.profileImageUrl = profileImageUrl;
    existing.updatedAt = now;
    return existing;
  }

  async updatePreferredLanguage(userId: string, preferredLanguage: string) {
    const existing = await this.findProfileByUserId(userId);
    const now = new Date();

    if (!existing) {
      const profile: UserProfile = {
        id: randomUUID(),
        userId,
        firstName: '',
        lastName: '',
        gender: null,
        profileImageUrl: null,
        dateOfBirth: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        preferredLanguage,
        createdAt: now,
        updatedAt: now,
      };
      this.profiles.push(profile);
      return profile;
    }

    existing.preferredLanguage = preferredLanguage;
    existing.updatedAt = now;
    return existing;
  }

  async listAddresses(input: { userId: string; page: number; limit: number }) {
    const filtered = this.addresses
      .filter((address) => address.userId === input.userId)
      .sort(
        (a, b) =>
          Number(b.isDefault) - Number(a.isDefault) ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
    const start = (input.page - 1) * input.limit;

    return {
      items: filtered.slice(start, start + input.limit),
      total: filtered.length,
    };
  }

  async createAddress(userId: string, data: CreateAddressData) {
    const now = new Date();
    const isDefault =
      data.isDefault || this.addresses.filter((address) => address.userId === userId).length === 0;

    if (isDefault) {
      this.addresses
        .filter((address) => address.userId === userId)
        .forEach((address) => {
          address.isDefault = false;
        });
    }

    const address: Address = {
      id: randomUUID(),
      userId,
      label: data.label as AddressLabel,
      address: data.address,
      latitude: data.latitude,
      longitude: data.longitude,
      isDefault,
      createdAt: now,
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

    Object.assign(address, data);
    return address;
  }

  async deleteAddress(userId: string, addressId: string) {
    const index = this.addresses.findIndex(
      (address) => address.userId === userId && address.id === addressId,
    );

    if (index === -1) {
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
    return address;
  }

  async listFavoriteLocations(input: { userId: string; page: number; limit: number }) {
    const filtered = this.favorites
      .filter((favorite) => favorite.userId === input.userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (input.page - 1) * input.limit;

    return {
      items: filtered.slice(start, start + input.limit),
      total: filtered.length,
    };
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

  async deleteFavoriteLocation(userId: string, favoriteId: string) {
    const index = this.favorites.findIndex(
      (favorite) => favorite.userId === userId && favorite.id === favoriteId,
    );

    if (index === -1) {
      return null;
    }

    const [deleted] = this.favorites.splice(index, 1);
    return deleted ?? null;
  }
}

export class MemoryObjectStorageProvider implements ObjectStorageProvider {
  public putObjects: PutObjectInput[] = [];

  async putObject(input: PutObjectInput) {
    this.putObjects.push(input);
    return { uri: `local://${input.bucket}/${input.key}` };
  }

  async getSignedReadUrl(bucket: string, key: string) {
    return `local://${bucket}/${key}?signed=true`;
  }

  async deleteObject() {
    return undefined;
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
