import type {
  DocumentVerificationStatus,
  Prisma,
  PrismaClient,
  Rider,
  RiderApprovalStatus,
  RiderDocument,
  RiderDocumentType,
  RiderOnboardingStatus,
  RiderOnlineStatus,
  RiderPreference,
  RiderStatus,
  Vehicle,
  VehicleType,
} from '@prisma/client';

export type CreateRiderData = {
  riderCode: string;
  profilePhoto?: string | null;
};

export type UpdateRiderData = Partial<{
  profilePhoto: string | null;
  status: RiderStatus;
  onboardingStatus: RiderOnboardingStatus;
  approvalStatus: RiderApprovalStatus;
  onlineStatus: RiderOnlineStatus;
  rating: number;
  totalTrips: number;
}>;

export type CreateVehicleData = {
  vehicleType: VehicleType;
  brand: string;
  model: string;
  color: string;
  registrationNumber: string;
  registrationState: string;
  manufacturingYear: number;
  insuranceExpiry?: Date | null;
  permitExpiry?: Date | null;
  isPrimary: boolean;
};

export type UpdateVehicleData = Partial<CreateVehicleData>;

export type CreateDocumentData = {
  documentType: RiderDocumentType;
  fileUrl: string;
  verificationStatus?: DocumentVerificationStatus;
};

export type UpdatePreferenceData = Partial<{
  preferredLanguage: string;
  autoAcceptTrips: boolean;
  receivePromotions: boolean;
}>;

export interface RiderRepositoryPort {
  findRiderByUserId(userId: string): Promise<Rider | null>;
  createRider(userId: string, data: CreateRiderData): Promise<Rider>;
  updateRider(riderId: string, data: UpdateRiderData): Promise<Rider>;
  listVehicles(riderId: string): Promise<Vehicle[]>;
  findVehicle(riderId: string, vehicleId: string): Promise<Vehicle | null>;
  findVehicleByRegistration(registrationNumber: string): Promise<Vehicle | null>;
  countVehicles(riderId: string): Promise<number>;
  createVehicle(riderId: string, data: CreateVehicleData): Promise<Vehicle>;
  updateVehicle(
    riderId: string,
    vehicleId: string,
    data: UpdateVehicleData,
  ): Promise<Vehicle | null>;
  deleteVehicle(riderId: string, vehicleId: string): Promise<Vehicle | null>;
  setPrimaryVehicle(riderId: string, vehicleId: string): Promise<Vehicle | null>;
  listDocuments(riderId: string): Promise<RiderDocument[]>;
  findDocument(riderId: string, documentId: string): Promise<RiderDocument | null>;
  findActiveDocumentByType(
    riderId: string,
    documentType: RiderDocumentType,
  ): Promise<RiderDocument | null>;
  createDocument(riderId: string, data: CreateDocumentData): Promise<RiderDocument>;
  deleteDocument(riderId: string, documentId: string): Promise<RiderDocument | null>;
  getOrCreatePreference(riderId: string): Promise<RiderPreference>;
  updatePreference(riderId: string, data: UpdatePreferenceData): Promise<RiderPreference>;
}

export class RiderRepository implements RiderRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findRiderByUserId(userId: string) {
    return this.prisma.rider.findUnique({ where: { userId } });
  }

  async createRider(userId: string, data: CreateRiderData) {
    return this.prisma.rider.create({
      data: {
        userId,
        riderCode: data.riderCode,
        profilePhoto: data.profilePhoto ?? null,
      },
    });
  }

  async updateRider(riderId: string, data: UpdateRiderData) {
    return this.prisma.rider.update({
      where: { id: riderId },
      data,
    });
  }

  async listVehicles(riderId: string) {
    return this.prisma.vehicle.findMany({
      where: { riderId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findVehicle(riderId: string, vehicleId: string) {
    return this.prisma.vehicle.findFirst({ where: { id: vehicleId, riderId } });
  }

  async findVehicleByRegistration(registrationNumber: string) {
    return this.prisma.vehicle.findUnique({ where: { registrationNumber } });
  }

  async countVehicles(riderId: string) {
    return this.prisma.vehicle.count({ where: { riderId } });
  }

  async createVehicle(riderId: string, data: CreateVehicleData) {
    return this.prisma.$transaction(async (tx) => {
      const existingCount = await tx.vehicle.count({ where: { riderId } });
      const isPrimary = data.isPrimary || existingCount === 0;

      if (isPrimary) {
        await unsetPrimaryVehicles(tx, riderId);
      }

      return tx.vehicle.create({
        data: {
          ...data,
          riderId,
          isPrimary,
        },
      });
    });
  }

  async updateVehicle(riderId: string, vehicleId: string, data: UpdateVehicleData) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.vehicle.findFirst({ where: { id: vehicleId, riderId } });

      if (!existing) {
        return null;
      }

      if (data.isPrimary) {
        await unsetPrimaryVehicles(tx, riderId);
      }

      return tx.vehicle.update({
        where: { id: vehicleId },
        data,
      });
    });
  }

  async deleteVehicle(riderId: string, vehicleId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.vehicle.findFirst({ where: { id: vehicleId, riderId } });

      if (!existing) {
        return null;
      }

      await tx.vehicle.delete({ where: { id: vehicleId } });

      if (existing.isPrimary) {
        const next = await tx.vehicle.findFirst({
          where: { riderId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });

        if (next) {
          await tx.vehicle.update({ where: { id: next.id }, data: { isPrimary: true } });
        }
      }

      return existing;
    });
  }

  async setPrimaryVehicle(riderId: string, vehicleId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.vehicle.findFirst({ where: { id: vehicleId, riderId } });

      if (!existing) {
        return null;
      }

      await unsetPrimaryVehicles(tx, riderId);

      return tx.vehicle.update({
        where: { id: vehicleId },
        data: { isPrimary: true },
      });
    });
  }

  async listDocuments(riderId: string) {
    return this.prisma.riderDocument.findMany({
      where: { riderId },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findDocument(riderId: string, documentId: string) {
    return this.prisma.riderDocument.findFirst({ where: { id: documentId, riderId } });
  }

  async findActiveDocumentByType(riderId: string, documentType: RiderDocumentType) {
    return this.prisma.riderDocument.findFirst({
      where: {
        riderId,
        documentType,
        verificationStatus: { in: ['PENDING', 'VERIFIED'] },
      },
    });
  }

  async createDocument(riderId: string, data: CreateDocumentData) {
    return this.prisma.riderDocument.create({
      data: {
        riderId,
        documentType: data.documentType,
        fileUrl: data.fileUrl,
        verificationStatus: data.verificationStatus ?? 'PENDING',
      },
    });
  }

  async deleteDocument(riderId: string, documentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.riderDocument.findFirst({ where: { id: documentId, riderId } });

      if (!existing) {
        return null;
      }

      await tx.riderDocument.delete({ where: { id: documentId } });
      return existing;
    });
  }

  async getOrCreatePreference(riderId: string) {
    return this.prisma.riderPreference.upsert({
      where: { riderId },
      create: { riderId },
      update: {},
    });
  }

  async updatePreference(riderId: string, data: UpdatePreferenceData) {
    return this.prisma.riderPreference.upsert({
      where: { riderId },
      create: { riderId, ...data },
      update: data,
    });
  }
}

async function unsetPrimaryVehicles(tx: Prisma.TransactionClient, riderId: string) {
  await tx.vehicle.updateMany({
    where: { riderId, isPrimary: true },
    data: { isPrimary: false },
  });
}
