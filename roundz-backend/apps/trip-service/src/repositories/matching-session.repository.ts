import type {
  MatchingSession,
  MatchingSessionStatus,
  PrismaClient,
  TripVehicleType,
} from '@prisma/client';

export type CreateMatchingSessionData = {
  tripId: string;
  strategy: string;
  vehicleType: TripVehicleType;
  pickupLatitude: number;
  pickupLongitude: number;
  currentRadiusMeters: number;
  maxRadiusMeters: number;
  expiresAt: Date;
};

export type UpdateMatchingSessionData = Partial<{
  status: MatchingSessionStatus;
  currentRadiusMeters: number;
  currentBatch: number;
  notifiedRiderCount: number;
  assignedRiderId: string | null;
  failureReason: string | null;
  expiresAt: Date;
}>;

export interface MatchingSessionRepositoryPort {
  findById(id: string): Promise<MatchingSession | null>;
  findByTripId(tripId: string): Promise<MatchingSession | null>;
  /** Creates a fresh session for a trip, resetting any prior session (retry-safe). */
  startForTrip(data: CreateMatchingSessionData): Promise<MatchingSession>;
  update(id: string, data: UpdateMatchingSessionData): Promise<MatchingSession>;
  incrementNotified(id: string, by: number): Promise<MatchingSession>;
}

export class MatchingSessionRepository implements MatchingSessionRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.matchingSession.findUnique({ where: { id } });
  }

  async findByTripId(tripId: string) {
    return this.prisma.matchingSession.findUnique({ where: { tripId } });
  }

  async startForTrip(data: CreateMatchingSessionData) {
    const base = {
      strategy: data.strategy,
      vehicleType: data.vehicleType,
      pickupLatitude: data.pickupLatitude,
      pickupLongitude: data.pickupLongitude,
      currentRadiusMeters: data.currentRadiusMeters,
      maxRadiusMeters: data.maxRadiusMeters,
      expiresAt: data.expiresAt,
      status: 'SEARCHING' as MatchingSessionStatus,
      currentBatch: 0,
      notifiedRiderCount: 0,
      assignedRiderId: null,
      failureReason: null,
    };

    return this.prisma.matchingSession.upsert({
      where: { tripId: data.tripId },
      create: { tripId: data.tripId, ...base },
      update: { ...base, startedAt: new Date() },
    });
  }

  async update(id: string, data: UpdateMatchingSessionData) {
    return this.prisma.matchingSession.update({ where: { id }, data });
  }

  async incrementNotified(id: string, by: number) {
    return this.prisma.matchingSession.update({
      where: { id },
      data: { notifiedRiderCount: { increment: by } },
    });
  }
}
