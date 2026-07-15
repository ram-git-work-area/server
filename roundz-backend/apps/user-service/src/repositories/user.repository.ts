import type {
  Address,
  AddressLabel,
  FavoriteLocation,
  Gender,
  Prisma,
  PrismaClient,
  UserProfile,
  UserSettings,
} from '@prisma/client';

export type ProfileUpdateData = {
  firstName?: string;
  lastName?: string;
  gender?: Gender | null;
  profileImageUrl?: string | null;
  dateOfBirth?: Date | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  preferredLanguage?: string;
};

export type CreateAddressData = {
  label: AddressLabel;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
};

export type UpdateAddressData = Partial<CreateAddressData>;

export type CreateFavoriteLocationData = {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

export type UpdateFavoriteLocationData = Partial<CreateFavoriteLocationData>;

export type UpdateSettingsData = Partial<{
  pushNotificationsEnabled: boolean;
  marketingNotificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
  darkModeEnabled: boolean;
  language: string;
  timezone: string;
}>;

export type CursorPagination = {
  userId: string;
  limit: number;
  cursor?: string;
};

export interface UserRepositoryPort {
  findProfileByUserId(userId: string): Promise<UserProfile | null>;
  upsertProfile(userId: string, data: ProfileUpdateData): Promise<UserProfile>;
  clearProfileImage(userId: string): Promise<UserProfile>;
  listAddresses(input: CursorPagination): Promise<Address[]>;
  createAddress(userId: string, data: CreateAddressData): Promise<Address>;
  updateAddress(
    userId: string,
    addressId: string,
    data: UpdateAddressData,
  ): Promise<Address | null>;
  deleteAddress(userId: string, addressId: string): Promise<Address | null>;
  setDefaultAddress(userId: string, addressId: string): Promise<Address | null>;
  listFavoriteLocations(input: CursorPagination): Promise<FavoriteLocation[]>;
  findFavoriteLocation(userId: string, favoriteId: string): Promise<FavoriteLocation | null>;
  createFavoriteLocation(
    userId: string,
    data: CreateFavoriteLocationData,
  ): Promise<FavoriteLocation>;
  updateFavoriteLocation(
    userId: string,
    favoriteId: string,
    data: UpdateFavoriteLocationData,
  ): Promise<FavoriteLocation | null>;
  deleteFavoriteLocation(userId: string, favoriteId: string): Promise<FavoriteLocation | null>;
  findDuplicateFavorite(
    userId: string,
    data: CreateFavoriteLocationData,
    excludeFavoriteId?: string,
  ): Promise<FavoriteLocation | null>;
  getOrCreateSettings(userId: string): Promise<UserSettings>;
  updateSettings(userId: string, data: UpdateSettingsData): Promise<UserSettings>;
}

export class UserRepository implements UserRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findProfileByUserId(userId: string) {
    return this.prisma.userProfile.findUnique({ where: { userId } });
  }

  async upsertProfile(userId: string, data: ProfileUpdateData) {
    return this.prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        firstName: data.firstName ?? '',
        lastName: data.lastName ?? '',
        gender: data.gender,
        profileImageUrl: data.profileImageUrl,
        dateOfBirth: data.dateOfBirth,
        emergencyContactName: data.emergencyContactName,
        emergencyContactPhone: data.emergencyContactPhone,
        preferredLanguage: data.preferredLanguage ?? 'en',
      },
      update: data,
    });
  }

  async clearProfileImage(userId: string) {
    return this.prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        firstName: '',
        lastName: '',
        profileImageUrl: null,
      },
      update: {
        profileImageUrl: null,
      },
    });
  }

  async listAddresses(input: CursorPagination) {
    return this.prisma.address.findMany({
      where: { userId: input.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
  }

  async createAddress(userId: string, data: CreateAddressData) {
    return this.prisma.$transaction(async (tx) => {
      const existingCount = await tx.address.count({ where: { userId } });
      const isDefault = data.isDefault || existingCount === 0;

      if (isDefault) {
        await unsetDefaultAddresses(tx, userId);
      }

      return tx.address.create({
        data: {
          ...data,
          userId,
          isDefault,
        },
      });
    });
  }

  async updateAddress(userId: string, addressId: string, data: UpdateAddressData) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findFirst({ where: { id: addressId, userId } });

      if (!existing) {
        return null;
      }

      if (data.isDefault) {
        await unsetDefaultAddresses(tx, userId);
      }

      return tx.address.update({
        where: { id: addressId },
        data,
      });
    });
  }

  async deleteAddress(userId: string, addressId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findFirst({ where: { id: addressId, userId } });

      if (!existing) {
        return null;
      }

      await tx.address.delete({ where: { id: addressId } });
      return existing;
    });
  }

  async setDefaultAddress(userId: string, addressId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findFirst({ where: { id: addressId, userId } });

      if (!existing) {
        return null;
      }

      await unsetDefaultAddresses(tx, userId);

      return tx.address.update({
        where: { id: addressId },
        data: { isDefault: true },
      });
    });
  }

  async listFavoriteLocations(input: CursorPagination) {
    return this.prisma.favoriteLocation.findMany({
      where: { userId: input.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
  }

  async findFavoriteLocation(userId: string, favoriteId: string) {
    return this.prisma.favoriteLocation.findFirst({
      where: { id: favoriteId, userId },
    });
  }

  async createFavoriteLocation(userId: string, data: CreateFavoriteLocationData) {
    return this.prisma.favoriteLocation.create({
      data: {
        ...data,
        userId,
      },
    });
  }

  async updateFavoriteLocation(
    userId: string,
    favoriteId: string,
    data: UpdateFavoriteLocationData,
  ) {
    const existing = await this.prisma.favoriteLocation.findFirst({
      where: { id: favoriteId, userId },
    });

    if (!existing) {
      return null;
    }

    return this.prisma.favoriteLocation.update({
      where: { id: favoriteId },
      data,
    });
  }

  async deleteFavoriteLocation(userId: string, favoriteId: string) {
    const existing = await this.prisma.favoriteLocation.findFirst({
      where: { id: favoriteId, userId },
    });

    if (!existing) {
      return null;
    }

    await this.prisma.favoriteLocation.delete({ where: { id: favoriteId } });
    return existing;
  }

  async findDuplicateFavorite(
    userId: string,
    data: CreateFavoriteLocationData,
    excludeFavoriteId?: string,
  ) {
    return this.prisma.favoriteLocation.findFirst({
      where: {
        userId,
        name: data.name,
        address: data.address,
        ...(excludeFavoriteId ? { id: { not: excludeFavoriteId } } : {}),
      },
    });
  }

  async getOrCreateSettings(userId: string) {
    return this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async updateSettings(userId: string, data: UpdateSettingsData) {
    return this.prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        ...data,
      },
      update: data,
    });
  }
}

async function unsetDefaultAddresses(tx: Prisma.TransactionClient, userId: string) {
  await tx.address.updateMany({
    where: { userId, isDefault: true },
    data: { isDefault: false },
  });
}
