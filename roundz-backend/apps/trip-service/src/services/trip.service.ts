import type {
  Trip,
  TripCancelledBy,
  TripPaymentMethod,
  TripStatus,
  TripType,
  TripVehicleType,
} from '@prisma/client';
import { AppError } from '@roundz/errors';
import { KafkaTopics } from '@roundz/kafka';
import { validate } from '@roundz/validation';
import {
  assertTransition,
  CUSTOMER_CANCELLABLE_STATUSES,
  isTerminalStatus,
  type TripStatusValue,
} from '../domain/trip-state-machine';
import type { TripRepositoryPort, UpdateStatusData } from '../repositories/trip.repository';
import {
  apiResponseSchema,
  collectionResponseSchema,
  tripSchema,
  type CancelTripRequest,
  type CreateTripRequest,
  type ListTripsQuery,
  type UpdateStatusRequest,
} from '../schemas/trip.schemas';
import { assertDistinctPickupAndDrop, assertValidCoordinates } from '../validators/trip.validators';
import { generateTripNumber } from '../utils/trip-number';
import type { TripEventName, TripEventPublisher } from '../events/trip-events.publisher';
import type { TripCache } from './trip-cache.service';

export type RequestContext = {
  requestId: string;
  traceId?: string;
};

export type TripServiceOptions = {
  repository: TripRepositoryPort;
  cache: TripCache;
  eventPublisher: TripEventPublisher;
  cacheTtlSeconds: number;
};

const MAX_TRIP_NUMBER_ATTEMPTS = 5;

export class TripService {
  constructor(private readonly options: TripServiceOptions) {}

  async createTrip(customerId: string, input: CreateTripRequest, context: RequestContext) {
    assertValidCoordinates(input.pickupLatitude, input.pickupLongitude, 'pickup');
    assertValidCoordinates(input.dropLatitude, input.dropLongitude, 'drop');
    assertDistinctPickupAndDrop(
      { latitude: input.pickupLatitude, longitude: input.pickupLongitude },
      { latitude: input.dropLatitude, longitude: input.dropLongitude },
    );

    await this.assertNoActiveTrip(customerId);

    const trip = await this.createWithUniqueTripNumber(customerId, input);

    await this.options.cache.setTrip(trip.id, trip, this.options.cacheTtlSeconds);
    await this.options.cache.setActiveTrip(customerId, trip, this.options.cacheTtlSeconds);

    await this.publish(KafkaTopics.TripCreated, trip.id, {
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      customerId,
      vehicleType: trip.vehicleType,
      tripType: trip.tripType,
      status: trip.status,
      requestId: context.requestId,
      traceId: context.traceId,
    });

    return validate(apiResponseSchema(tripSchema), { data: trip });
  }

  async getTrip(tripId: string, requesterId: string, isPrivileged: boolean) {
    const trip = await this.resolveTrip(tripId);
    this.assertCanAccess(trip, requesterId, isPrivileged);

    return validate(apiResponseSchema(tripSchema), { data: trip });
  }

  async listTrips(customerId: string, query: ListTripsQuery) {
    const trips = await this.options.repository.list({
      customerId,
      limit: query.limit,
      cursor: query.cursor,
      status: query.status as TripStatus | undefined,
      from: query.from,
      to: query.to,
    });

    const hasMore = trips.length > query.limit;
    const page = hasMore ? trips.slice(0, query.limit) : trips;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    return validate(collectionResponseSchema(tripSchema), {
      data: page,
      meta: { pagination: { limit: query.limit, nextCursor, hasMore } },
    });
  }

  async cancelTrip(
    customerId: string,
    tripId: string,
    input: CancelTripRequest,
    context: RequestContext,
  ) {
    const trip = await this.resolveTrip(tripId);
    this.assertCanAccess(trip, customerId, false);

    const currentStatus = trip.status as TripStatusValue;
    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(currentStatus)) {
      throw new AppError(
        `Trip cannot be cancelled in status ${currentStatus}`,
        409,
        'TRIP_NOT_CANCELLABLE',
        { status: currentStatus },
      );
    }

    assertTransition(currentStatus, 'CANCELLED');

    const updated = await this.applyStatusChange(
      trip,
      {
        status: 'CANCELLED',
        description: input.reason,
        cancellationReason: input.reason,
        cancelledBy: 'CUSTOMER',
      },
      context,
    );

    await this.publish(KafkaTopics.TripCancelled, updated.id, {
      tripId: updated.id,
      customerId: updated.customerId,
      cancelledBy: 'CUSTOMER',
      reason: input.reason,
      requestId: context.requestId,
      traceId: context.traceId,
    });

    return validate(apiResponseSchema(tripSchema), { data: updated });
  }

  async updateStatus(tripId: string, input: UpdateStatusRequest, context: RequestContext) {
    const trip = await this.resolveTrip(tripId);
    const nextStatus = input.status as TripStatusValue;

    assertTransition(trip.status as TripStatusValue, nextStatus);

    const updated = await this.applyStatusChange(
      trip,
      {
        status: nextStatus,
        description: input.description ?? defaultDescription(nextStatus),
        riderId: input.riderId,
        cancellationReason: input.cancellationReason,
        cancelledBy: input.cancelledBy as TripCancelledBy | undefined,
        actualFare: input.actualFare,
      },
      context,
    );

    if (nextStatus === 'SEARCHING_RIDER') {
      await this.publish(KafkaTopics.TripSearchStarted, updated.id, {
        tripId: updated.id,
        customerId: updated.customerId,
        vehicleType: updated.vehicleType,
        pickupLatitude: updated.pickupLatitude,
        pickupLongitude: updated.pickupLongitude,
        requestId: context.requestId,
        traceId: context.traceId,
      });
    }

    if (nextStatus === 'CANCELLED') {
      await this.publish(KafkaTopics.TripCancelled, updated.id, {
        tripId: updated.id,
        customerId: updated.customerId,
        cancelledBy: updated.cancelledBy,
        reason: updated.cancellationReason,
        requestId: context.requestId,
        traceId: context.traceId,
      });
    }

    return validate(apiResponseSchema(tripSchema), { data: updated });
  }

  private async applyStatusChange(
    trip: Trip,
    data: {
      status: TripStatusValue;
      description: string;
      riderId?: string;
      cancellationReason?: string;
      cancelledBy?: TripCancelledBy;
      actualFare?: number;
    },
    context?: RequestContext,
  ) {
    const previousStatus = trip.status;
    const updated = await this.options.repository.updateStatusWithTimeline(trip.id, {
      status: data.status as TripStatus,
      description: data.description,
      riderId: data.riderId,
      cancellationReason: data.cancellationReason,
      cancelledBy: data.cancelledBy,
      actualFare: data.actualFare,
    } satisfies UpdateStatusData);

    await this.options.cache.setTrip(updated.id, updated, this.options.cacheTtlSeconds);

    if (isTerminalStatus(data.status)) {
      await this.options.cache.deleteActiveTrip(updated.customerId);
    } else {
      await this.options.cache.setActiveTrip(
        updated.customerId,
        updated,
        this.options.cacheTtlSeconds,
      );
    }

    await this.publish(KafkaTopics.TripStatusChanged, updated.id, {
      tripId: updated.id,
      customerId: updated.customerId,
      riderId: updated.riderId,
      previousStatus,
      status: updated.status,
      requestId: context?.requestId,
      traceId: context?.traceId,
    });

    return updated;
  }

  private async assertNoActiveTrip(customerId: string) {
    const cached = await this.options.cache.getActiveTrip(customerId);
    if (cached) {
      throw activeTripError();
    }

    const active = await this.options.repository.findActiveByCustomer(customerId);
    if (active) {
      await this.options.cache.setActiveTrip(customerId, active, this.options.cacheTtlSeconds);
      throw activeTripError();
    }
  }

  private async createWithUniqueTripNumber(customerId: string, input: CreateTripRequest) {
    for (let attempt = 0; attempt < MAX_TRIP_NUMBER_ATTEMPTS; attempt += 1) {
      try {
        return await this.options.repository.createWithTimeline(
          {
            tripNumber: generateTripNumber(),
            customerId,
            vehicleType: input.vehicleType as TripVehicleType,
            tripType: input.tripType as TripType,
            pickupLatitude: input.pickupLatitude,
            pickupLongitude: input.pickupLongitude,
            pickupAddress: input.pickupAddress,
            dropLatitude: input.dropLatitude,
            dropLongitude: input.dropLongitude,
            dropAddress: input.dropAddress,
            estimatedDistance: input.estimatedDistance,
            estimatedDuration: input.estimatedDuration,
            estimatedFare: input.estimatedFare,
            paymentMethod: input.paymentMethod as TripPaymentMethod,
          },
          defaultDescription('REQUESTED'),
        );
      } catch (error) {
        if (isUniqueViolation(error) && attempt < MAX_TRIP_NUMBER_ATTEMPTS - 1) {
          continue;
        }
        throw error;
      }
    }

    throw new AppError('Failed to generate a unique trip number', 500, 'TRIP_NUMBER_GENERATION');
  }

  private async resolveTrip(tripId: string): Promise<Trip> {
    const cached = await this.options.cache.getTrip(tripId);
    if (cached) {
      return cached;
    }

    const trip = await this.options.repository.findById(tripId);
    if (!trip) {
      throw new AppError('Trip not found', 404, 'TRIP_NOT_FOUND');
    }

    await this.options.cache.setTrip(tripId, trip, this.options.cacheTtlSeconds);
    return trip;
  }

  private assertCanAccess(trip: Trip, requesterId: string, isPrivileged: boolean) {
    if (!isPrivileged && trip.customerId !== requesterId) {
      throw new AppError('Not allowed to access this trip', 403, 'TRIP_FORBIDDEN');
    }
  }

  private async publish<TPayload extends Record<string, unknown>>(
    topic: TripEventName,
    key: string,
    payload: TPayload,
  ) {
    await this.options.eventPublisher.publish(topic, key, payload);
  }
}

function activeTripError() {
  return new AppError('Customer already has an active trip', 409, 'TRIP_ACTIVE_EXISTS');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function defaultDescription(status: TripStatusValue): string {
  const descriptions: Record<TripStatusValue, string> = {
    REQUESTED: 'Trip requested',
    SEARCHING_RIDER: 'Searching for a rider',
    RIDER_ASSIGNED: 'Rider assigned',
    RIDER_ARRIVING: 'Rider is arriving',
    OTP_PENDING: 'Waiting for trip start OTP',
    IN_PROGRESS: 'Trip in progress',
    COMPLETED: 'Trip completed',
    CANCELLED: 'Trip cancelled',
    FAILED: 'Trip failed',
  };

  return descriptions[status];
}
