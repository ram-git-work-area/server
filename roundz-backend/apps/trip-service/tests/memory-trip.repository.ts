import { randomUUID } from 'node:crypto';
import type { Trip, TripStatus, TripTimeline } from '@prisma/client';
import { ACTIVE_TRIP_STATUSES } from '../src/domain/trip-state-machine';
import type {
  CreateTripData,
  ListTripsParams,
  TripRepositoryPort,
  UpdateStatusData,
} from '../src/repositories/trip.repository';
import type { TripEventName, TripEventPublisher } from '../src/events/trip-events.publisher';

const ACTIVE = ACTIVE_TRIP_STATUSES as unknown as TripStatus[];

export class MemoryTripRepository implements TripRepositoryPort {
  public trips: Trip[] = [];
  public timelines: TripTimeline[] = [];

  async findById(tripId: string) {
    return this.trips.find((trip) => trip.id === tripId) ?? null;
  }

  async findByIdWithTimeline(tripId: string) {
    const trip = await this.findById(tripId);
    if (!trip) {
      return null;
    }

    const timeline = this.timelines
      .filter((entry) => entry.tripId === tripId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

    return { ...trip, timeline };
  }

  async findActiveByCustomer(customerId: string) {
    return (
      this.trips
        .filter((trip) => trip.customerId === customerId && ACTIVE.includes(trip.status))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async createWithTimeline(data: CreateTripData, timelineDescription: string) {
    if (this.trips.some((trip) => trip.tripNumber === data.tripNumber)) {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    }

    const now = new Date();
    const trip: Trip = {
      id: randomUUID(),
      tripNumber: data.tripNumber,
      customerId: data.customerId,
      riderId: null,
      vehicleType: data.vehicleType,
      tripType: data.tripType,
      status: 'REQUESTED',
      pickupLatitude: data.pickupLatitude,
      pickupLongitude: data.pickupLongitude,
      pickupAddress: data.pickupAddress,
      dropLatitude: data.dropLatitude,
      dropLongitude: data.dropLongitude,
      dropAddress: data.dropAddress,
      estimatedDistance: data.estimatedDistance,
      estimatedDuration: data.estimatedDuration,
      estimatedFare: data.estimatedFare,
      actualFare: null,
      paymentMethod: data.paymentMethod,
      cancellationReason: null,
      cancelledBy: null,
      createdAt: now,
      updatedAt: now,
    };
    this.trips.push(trip);
    this.addTimeline(trip.id, trip.status, timelineDescription);
    return trip;
  }

  async updateStatusWithTimeline(tripId: string, data: UpdateStatusData) {
    const trip = await this.findById(tripId);
    if (!trip) {
      throw new Error(`Trip not found: ${tripId}`);
    }

    trip.status = data.status;
    if (data.riderId !== undefined) {
      trip.riderId = data.riderId;
    }
    if (data.cancellationReason !== undefined) {
      trip.cancellationReason = data.cancellationReason;
    }
    if (data.cancelledBy !== undefined) {
      trip.cancelledBy = data.cancelledBy;
    }
    if (data.actualFare !== undefined) {
      trip.actualFare = data.actualFare;
    }
    trip.updatedAt = new Date();

    this.addTimeline(trip.id, data.status, data.description);
    return trip;
  }

  async list(params: ListTripsParams) {
    const sorted = this.trips
      .filter((trip) => trip.customerId === params.customerId)
      .filter((trip) => (params.status ? trip.status === params.status : true))
      .filter((trip) => (params.from ? trip.createdAt.getTime() >= params.from.getTime() : true))
      .filter((trip) => (params.to ? trip.createdAt.getTime() <= params.to.getTime() : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));

    const start = params.cursor
      ? Math.max(0, sorted.findIndex((trip) => trip.id === params.cursor) + 1)
      : 0;
    return sorted.slice(start, start + params.limit + 1);
  }

  private addTimeline(tripId: string, status: TripStatus, description: string) {
    this.timelines.push({
      id: randomUUID(),
      tripId,
      status,
      description,
      createdAt: new Date(Date.now() + this.timelines.length),
    });
  }
}

export class MemoryTripEventPublisher implements TripEventPublisher {
  public events: Array<{ topic: TripEventName; key: string; payload: Record<string, unknown> }> =
    [];

  async publish<TPayload extends Record<string, unknown>>(
    topic: TripEventName,
    key: string,
    payload: TPayload,
  ) {
    this.events.push({ topic, key, payload });
  }

  topics() {
    return this.events.map((event) => event.topic);
  }
}
