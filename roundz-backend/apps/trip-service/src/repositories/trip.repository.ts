import type {
  Prisma,
  PrismaClient,
  Trip,
  TripCancelledBy,
  TripPaymentMethod,
  TripStatus,
  TripTimeline,
  TripType,
  TripVehicleType,
} from '@prisma/client';
import { ACTIVE_TRIP_STATUSES } from '../domain/trip-state-machine';

export type TripWithTimeline = Trip & { timeline: TripTimeline[] };

export type CreateTripData = {
  tripNumber: string;
  customerId: string;
  vehicleType: TripVehicleType;
  tripType: TripType;
  pickupLatitude: number;
  pickupLongitude: number;
  pickupAddress: string;
  dropLatitude: number;
  dropLongitude: number;
  dropAddress: string;
  estimatedDistance: number;
  estimatedDuration: number;
  estimatedFare: number;
  paymentMethod: TripPaymentMethod;
};

export type UpdateStatusData = {
  status: TripStatus;
  description: string;
  riderId?: string;
  cancellationReason?: string;
  cancelledBy?: TripCancelledBy;
  actualFare?: number;
};

export type ListTripsParams = {
  customerId: string;
  limit: number;
  cursor?: string;
  status?: TripStatus;
  from?: Date;
  to?: Date;
};

export interface TripRepositoryPort {
  findById(tripId: string): Promise<Trip | null>;
  findByIdWithTimeline(tripId: string): Promise<TripWithTimeline | null>;
  findActiveByCustomer(customerId: string): Promise<Trip | null>;
  createWithTimeline(data: CreateTripData, timelineDescription: string): Promise<Trip>;
  updateStatusWithTimeline(tripId: string, data: UpdateStatusData): Promise<Trip>;
  list(params: ListTripsParams): Promise<Trip[]>;
}

const ACTIVE_STATUSES = ACTIVE_TRIP_STATUSES as unknown as TripStatus[];

export class TripRepository implements TripRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(tripId: string) {
    return this.prisma.trip.findUnique({ where: { id: tripId } });
  }

  async findByIdWithTimeline(tripId: string) {
    return this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { timeline: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
  }

  async findActiveByCustomer(customerId: string) {
    return this.prisma.trip.findFirst({
      where: { customerId, status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createWithTimeline(data: CreateTripData, timelineDescription: string) {
    return this.prisma.$transaction(async (tx) => {
      const trip = await tx.trip.create({ data });
      await tx.tripTimeline.create({
        data: {
          tripId: trip.id,
          status: trip.status,
          description: timelineDescription,
        },
      });
      return trip;
    });
  }

  async updateStatusWithTimeline(tripId: string, data: UpdateStatusData) {
    return this.prisma.$transaction(async (tx) => {
      const trip = await tx.trip.update({
        where: { id: tripId },
        data: {
          status: data.status,
          ...(data.riderId !== undefined ? { riderId: data.riderId } : {}),
          ...(data.cancellationReason !== undefined
            ? { cancellationReason: data.cancellationReason }
            : {}),
          ...(data.cancelledBy !== undefined ? { cancelledBy: data.cancelledBy } : {}),
          ...(data.actualFare !== undefined ? { actualFare: data.actualFare } : {}),
        },
      });
      await tx.tripTimeline.create({
        data: {
          tripId: trip.id,
          status: data.status,
          description: data.description,
        },
      });
      return trip;
    });
  }

  async list(params: ListTripsParams) {
    const where: Prisma.TripWhereInput = { customerId: params.customerId };

    if (params.status) {
      where.status = params.status;
    }

    if (params.from || params.to) {
      where.createdAt = {
        ...(params.from ? { gte: params.from } : {}),
        ...(params.to ? { lte: params.to } : {}),
      };
    }

    return this.prisma.trip.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
  }
}
