import type {
  Address,
  AddressLabel,
  FavoriteLocation,
  Gender,
  Prisma,
  PrismaClient,
  UserProfile,
} from '@prisma/client';

export type ProfileUpdateData = {
  firstName?: string;
  lastName?: string;
  gender?: Gender | null;
  dateOfBirth?: Date | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
};

export type CreateAddressData = {
  label: AddressLabel;
  address: string;
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

export interface UserRepositoryPort {
  findProfileByUserId(userId: string): Promise<UserProfile | null>;
  upsertProfile(userId: string, data: ProfileUpdateData): Promise<UserProfile>;
  updateProfileImage(userId: string, profileImageUrl: string): Promise<UserProfile>;
  updatePreferredLanguage(userId: string, preferredLanguage: string): Promise<UserProfile>;
  listAddresses(input: {
    userId: string;
    page: number;
    limit: number;
  }): Promise<{ items: Address[]; total: number }>;
  createAddress(userId: string, data: CreateAddressData): Promise<Address>;
  updateAddress(
    userId: string,
    addressId: string,
    data: UpdateAddressData,
  ): Promise<Address | null>;
  deleteAddress(userId: string, addressId: string): Promise<Address | null>;
  setDefaultAddress(userId: string, addressId: string): Promise<Address | null>;
  listFavoriteLocations(input: {
    userId: string;
    page: number;
    limit: number;
  }): Promise<{ items: FavoriteLocation[]; total: number }>;
  createFavoriteLocation(
    userId: string,
    data: CreateFavoriteLocationData,
  ): Promise<FavoriteLocation>;
  deleteFavoriteLocation(userId: string, favoriteId: string): Promise<FavoriteLocation | null>;
}

export class UserRepository implements UserRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findProfileByUserId(userId: string) {
    return this.prisma.userProfile.findUnique({
      where: { userId },
    });
  }

  async upsertProfile(userId: string, data: ProfileUpdateData) {
    return this.prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        firstName: data.firstName ?? '',
        lastName: data.lastName ?? '',
        gender: data.gender,
        dateOfBirth: data.dateOfBirth,
        emergencyContactName: data.emergencyContactName,
        emergencyContactPhone: data.emergencyContactPhone,
      },
      update: data,
    });
  }

  async updateProfileImage(userId: string, profileImageUrl: string) {
    return this.prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        firstName: '',
        lastName: '',
        profileImageUrl,
      },
      update: {
        profileImageUrl,
      },
    });
  }

  async updatePreferredLanguage(userId: string, preferredLanguage: string) {
    return this.prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        firstName: '',
        lastName: '',
        preferredLanguage,
      },
      update: {
        preferredLanguage,
      },
    });
  }

  async listAddresses(input: { userId: string; page: number; limit: number }) {
    const skip = (input.page - 1) * input.limit;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.address.findMany({
        where: { userId: input.userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: input.limit,
      }),
      this.prisma.address.count({
        where: { userId: input.userId },
      }),
    ]);

    return { items, total };
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
      const existing = await tx.address.findFirst({
        where: { id: addressId, userId },
      });

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
      const existing = await tx.address.findFirst({
        where: { id: addressId, userId },
      });

      if (!existing) {
        return null;
      }

      await tx.address.delete({
        where: { id: addressId },
      });

      return existing;
    });
  }

  async setDefaultAddress(userId: string, addressId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findFirst({
        where: { id: addressId, userId },
      });

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

  async listFavoriteLocations(input: { userId: string; page: number; limit: number }) {
    const skip = (input.page - 1) * input.limit;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.favoriteLocation.findMany({
        where: { userId: input.userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: input.limit,
      }),
      this.prisma.favoriteLocation.count({
        where: { userId: input.userId },
      }),
    ]);

    return { items, total };
  }

  async createFavoriteLocation(userId: string, data: CreateFavoriteLocationData) {
    return this.prisma.favoriteLocation.create({
      data: {
        ...data,
        userId,
      },
    });
  }

  async deleteFavoriteLocation(userId: string, favoriteId: string) {
    const existing = await this.prisma.favoriteLocation.findFirst({
      where: { id: favoriteId, userId },
    });

    if (!existing) {
      return null;
    }

    await this.prisma.favoriteLocation.delete({
      where: { id: favoriteId },
    });

    return existing;
  }
}

async function unsetDefaultAddresses(tx: Prisma.TransactionClient, userId: string) {
  await tx.address.updateMany({
    where: {
      userId,
      isDefault: true,
    },
    data: {
      isDefault: false,
    },
  });
}
