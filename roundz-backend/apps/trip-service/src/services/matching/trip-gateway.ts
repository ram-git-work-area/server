import type { Trip, TripCancelledBy, TripStatus } from '@prisma/client';
import { KafkaTopics } from '@roundz/kafka';
import {
  assertTransition,
  isTerminalStatus,
  type TripStatusValue,
} from '../../domain/trip-state-machine';
import type { TripRepositoryPort } from '../../repositories/trip.repository';
import type { TripCache } from '../trip-cache.service';
import type { MatchingEventPublisher } from '../../events/matching-events.publisher';

export type TripTransitionInput = {
  toStatus: TripStatusValue;
  description: string;
  riderId?: string;
  cancelledBy?: TripCancelledBy;
  cancellationReason?: string;
};

export type TransitionContext = {
  requestId?: string;
  traceId?: string;
};

/**
 * Thin boundary the matching engine uses to read a trip and drive its lifecycle
 * transitions. Reuses the Phase 1 repository, cache, and state machine so the
 * transition rules and timeline auditing stay in one place.
 */
export interface TripGateway {
  getTrip(tripId: string): Promise<Trip | null>;
  transition(tripId: string, input: TripTransitionInput, ctx?: TransitionContext): Promise<Trip>;
}

export class RepositoryTripGateway implements TripGateway {
  constructor(
    private readonly repository: TripRepositoryPort,
    private readonly cache: TripCache,
    private readonly eventPublisher: MatchingEventPublisher,
    private readonly cacheTtlSeconds: number,
  ) {}

  async getTrip(tripId: string): Promise<Trip | null> {
    const cached = await this.cache.getTrip(tripId);
    if (cached) {
      return cached;
    }

    const trip = await this.repository.findById(tripId);
    if (trip) {
      await this.cache.setTrip(tripId, trip, this.cacheTtlSeconds);
    }
    return trip;
  }

  async transition(
    tripId: string,
    input: TripTransitionInput,
    ctx?: TransitionContext,
  ): Promise<Trip> {
    const trip = await this.repository.findById(tripId);
    if (!trip) {
      throw new Error(`Trip not found: ${tripId}`);
    }

    const previousStatus = trip.status;
    assertTransition(trip.status as TripStatusValue, input.toStatus);

    const updated = await this.repository.updateStatusWithTimeline(tripId, {
      status: input.toStatus as TripStatus,
      description: input.description,
      riderId: input.riderId,
      cancelledBy: input.cancelledBy,
      cancellationReason: input.cancellationReason,
    });

    await this.cache.setTrip(updated.id, updated, this.cacheTtlSeconds);
    if (isTerminalStatus(input.toStatus)) {
      await this.cache.deleteActiveTrip(updated.customerId);
    } else {
      await this.cache.setActiveTrip(updated.customerId, updated, this.cacheTtlSeconds);
    }

    await this.eventPublisher.publish(KafkaTopics.TripStatusChanged, updated.id, {
      tripId: updated.id,
      customerId: updated.customerId,
      riderId: updated.riderId,
      previousStatus,
      status: updated.status,
      requestId: ctx?.requestId,
      traceId: ctx?.traceId,
    });

    return updated;
  }
}
