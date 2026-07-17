import type { MatchingSession, Trip } from '@prisma/client';
import { AppError } from '@roundz/errors';
import { KafkaTopics } from '@roundz/kafka';
import type { DistributedLock } from '@roundz/redis';
import { evaluateEligibility } from '../../domain/matching/eligibility';
import type { MatchingStrategy } from '../../domain/matching/matching-strategy';
import type {
  MatchingContext,
  RiderCandidate,
  RiderEligibilitySnapshot,
} from '../../domain/matching/matching-types';
import { isTerminalStatus, type TripStatusValue } from '../../domain/trip-state-machine';
import type { LocationClient } from '../../clients/location.client';
import type { RiderClient } from '../../clients/rider.client';
import type { MatchingEventPublisher } from '../../events/matching-events.publisher';
import type { MatchingSessionRepositoryPort } from '../../repositories/matching-session.repository';
import type { DispatchScheduler } from './dispatch-scheduler';
import type { DispatchStore } from './dispatch.store';
import type { RiderAvailabilityCache } from './rider-availability.cache';
import type { TripGateway } from './trip-gateway';

export type MatchingLogger = {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
};

export const noopMatchingLogger: MatchingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export type MatchingEngineConfig = {
  searchRadiiMeters: number[];
  batchSize: number;
  dispatchTimeoutSeconds: number;
  sessionTtlSeconds: number;
  lockTtlSeconds: number;
  riderAvailabilityTtlSeconds: number;
  maxCandidatesPerRadius: number;
};

export type MatchingEngineOptions = {
  tripGateway: TripGateway;
  sessionRepository: MatchingSessionRepositoryPort;
  locationClient: LocationClient;
  riderClient: RiderClient;
  availabilityCache: RiderAvailabilityCache;
  dispatchStore: DispatchStore;
  lock: DistributedLock;
  scheduler: DispatchScheduler;
  eventPublisher: MatchingEventPublisher;
  strategy: MatchingStrategy;
  config: MatchingEngineConfig;
  logger?: MatchingLogger;
};

export type MatchingRequestContext = {
  requestId?: string;
  traceId?: string;
};

const ACTIVE_SESSION_STATUSES = ['SEARCHING', 'DISPATCHING'] as const;

export class MatchingEngine {
  private readonly logger: MatchingLogger;

  constructor(private readonly options: MatchingEngineOptions) {
    this.logger = options.logger ?? noopMatchingLogger;
  }

  /**
   * Entry point for `trip.created` (or the manual internal API). Guarded by a
   * distributed lock so only one worker starts matching for a given trip.
   */
  async startMatching(tripId: string, ctx: MatchingRequestContext = {}): Promise<void> {
    await this.withTripLock(tripId, async () => {
      const trip = await this.options.tripGateway.getTrip(tripId);
      if (!trip) {
        throw new AppError('Trip not found', 404, 'TRIP_NOT_FOUND', { tripId });
      }

      const status = trip.status as TripStatusValue;
      if (isTerminalStatus(status)) {
        this.logger.info({ ...this.base(ctx, tripId), status }, 'matching skipped: trip terminal');
        return;
      }
      if (status !== 'REQUESTED' && status !== 'SEARCHING_RIDER') {
        this.logger.info(
          { ...this.base(ctx, tripId), status },
          'matching skipped: trip not awaiting a rider',
        );
        return;
      }

      const existing = await this.options.sessionRepository.findByTripId(tripId);
      if (existing && existing.status === 'ASSIGNED') {
        this.logger.info({ ...this.base(ctx, tripId) }, 'matching skipped: rider already assigned');
        return;
      }

      const radii = this.options.config.searchRadiiMeters;
      const firstRadius = radii[0] ?? 5000;
      const maxRadius = radii[radii.length - 1] ?? firstRadius;
      const now = Date.now();

      const session = await this.options.sessionRepository.startForTrip({
        tripId,
        strategy: this.options.strategy.name,
        vehicleType: trip.vehicleType,
        pickupLatitude: trip.pickupLatitude,
        pickupLongitude: trip.pickupLongitude,
        currentRadiusMeters: firstRadius,
        maxRadiusMeters: maxRadius,
        expiresAt: new Date(now + this.options.config.sessionTtlSeconds * 1000),
      });

      await this.options.dispatchStore.clearSession(tripId);

      if (status === 'REQUESTED') {
        await this.options.tripGateway.transition(
          tripId,
          { toStatus: 'SEARCHING_RIDER', description: 'Searching for a rider' },
          ctx,
        );
      }

      await this.publish(KafkaTopics.TripSearchStarted, tripId, {
        tripId,
        matchingSessionId: session.id,
        customerId: trip.customerId,
        vehicleType: trip.vehicleType,
        pickupLatitude: trip.pickupLatitude,
        pickupLongitude: trip.pickupLongitude,
        strategy: this.options.strategy.name,
        radiusMeters: firstRadius,
        ctx,
      });

      this.logger.info(
        {
          ...this.base(ctx, tripId),
          matchingSessionId: session.id,
          strategy: this.options.strategy.name,
        },
        'matching started',
      );

      await this.runDispatchCycle(session, trip, ctx);
    });
  }

  /**
   * Records a rider's accept/reject decision. Publishes the authoritative
   * accepted/rejected event and, on acceptance, assigns the rider under an
   * assignment lock so a rider can only ever be bound to one trip.
   */
  async submitRiderDecision(
    tripId: string,
    riderId: string,
    accepted: boolean,
    ctx: MatchingRequestContext = {},
  ): Promise<void> {
    await this.withTripLock(tripId, async () => {
      const session = await this.options.sessionRepository.findByTripId(tripId);
      if (!session || !this.isActive(session)) {
        this.logger.warn(
          { ...this.base(ctx, tripId), riderId },
          'rider decision ignored: no active matching session',
        );
        return;
      }

      const offered = await this.options.dispatchStore.getOfferedRiders(tripId);
      if (!offered.includes(riderId)) {
        this.logger.warn(
          { ...this.base(ctx, tripId), riderId },
          'rider decision ignored: rider was not offered this trip',
        );
        return;
      }

      if (accepted) {
        await this.handleAcceptance(session, riderId, ctx);
      } else {
        await this.handleRejection(session, riderId, ctx);
      }
    });
  }

  /** Called by the scheduler when a batch's dispatch window elapses. */
  async handleDispatchTimeout(tripId: string, ctx: MatchingRequestContext = {}): Promise<void> {
    await this.withTripLock(tripId, async () => {
      const session = await this.options.sessionRepository.findByTripId(tripId);
      if (!session || !this.isActive(session)) {
        return;
      }

      const trip = await this.options.tripGateway.getTrip(tripId);
      if (!trip || isTerminalStatus(trip.status as TripStatusValue)) {
        await this.cancelInternal(session, ctx);
        return;
      }

      const pending = await this.options.dispatchStore.getPendingRiders(tripId);
      for (const riderId of pending) {
        await this.options.dispatchStore.releaseRider(riderId);
        await this.options.dispatchStore.clearPending(tripId, riderId);
      }

      this.logger.info(
        { ...this.base(ctx, tripId), matchingSessionId: session.id, expiredOffers: pending.length },
        'dispatch batch timed out, advancing',
      );

      await this.runDispatchCycle(session, trip, ctx);
    });
  }

  /** Called on `trip.cancelled`; stops matching and releases all reservations. */
  async cancelMatching(tripId: string, ctx: MatchingRequestContext = {}): Promise<void> {
    await this.withTripLock(tripId, async () => {
      const session = await this.options.sessionRepository.findByTripId(tripId);
      if (!session || !this.isActive(session)) {
        return;
      }
      await this.cancelInternal(session, ctx);
    });
  }

  async getSession(tripId: string): Promise<MatchingSession | null> {
    return this.options.sessionRepository.findByTripId(tripId);
  }

  /**
   * Keeps the hot availability cache fresh from `rider.status.changed` so
   * eligibility checks avoid a Rider Service round-trip on the hot path.
   */
  async ingestRiderStatus(snapshot: RiderEligibilitySnapshot): Promise<void> {
    await this.options.availabilityCache.set(
      snapshot.riderId,
      snapshot,
      this.options.config.riderAvailabilityTtlSeconds,
    );
  }

  /**
   * Refreshes presence from `location.updated`. If we already hold a snapshot we
   * mark the rider as having a current location and extend its TTL; otherwise the
   * next dispatch will lazily hydrate from the Rider Service.
   */
  async ingestRiderLocation(riderId: string): Promise<void> {
    const cached = await this.options.availabilityCache.get(riderId);
    if (cached) {
      await this.options.availabilityCache.set(
        riderId,
        { ...cached, hasCurrentLocation: true },
        this.options.config.riderAvailabilityTtlSeconds,
      );
    }
  }

  private async handleAcceptance(
    session: MatchingSession,
    riderId: string,
    ctx: MatchingRequestContext,
  ): Promise<void> {
    const tripId = session.tripId;
    const assignmentLock = await this.options.lock.acquire(
      assignmentKey(riderId),
      this.options.config.lockTtlSeconds * 1000,
    );
    if (!assignmentLock) {
      this.logger.warn(
        { ...this.base(ctx, tripId), riderId },
        'acceptance rejected: rider is being assigned to another trip',
      );
      await this.rejectAndAdvance(session, riderId, ctx, 'rider unavailable');
      return;
    }

    try {
      const trip = await this.options.tripGateway.getTrip(tripId);
      if (!trip || (trip.status as TripStatusValue) !== 'SEARCHING_RIDER') {
        this.logger.warn(
          { ...this.base(ctx, tripId), riderId, status: trip?.status },
          'acceptance ignored: trip no longer awaiting assignment',
        );
        return;
      }

      const snapshot = await this.resolveSnapshot(riderId);
      if (snapshot && !evaluateEligibility(snapshot, trip.vehicleType).eligible) {
        this.logger.warn(
          { ...this.base(ctx, tripId), riderId },
          'acceptance rejected: rider no longer eligible',
        );
        await this.rejectAndAdvance(session, riderId, ctx, 'rider no longer eligible');
        return;
      }

      // Durable, cross-trip guarantee that a rider is bound to exactly one trip.
      const bound = await this.options.dispatchStore.bindRider(
        tripId,
        riderId,
        this.options.config.sessionTtlSeconds,
      );
      if (!bound) {
        this.logger.warn(
          { ...this.base(ctx, tripId), riderId },
          'acceptance rejected: rider already bound to another trip',
        );
        await this.rejectAndAdvance(session, riderId, ctx, 'rider already assigned');
        return;
      }

      await this.publish(KafkaTopics.TripRiderAccepted, tripId, {
        tripId,
        matchingSessionId: session.id,
        riderId,
        ctx,
      });

      await this.options.tripGateway.transition(
        tripId,
        { toStatus: 'RIDER_ASSIGNED', description: 'Rider assigned', riderId },
        ctx,
      );

      const matchingDurationMs = Date.now() - session.startedAt.getTime();
      await this.publish(KafkaTopics.TripRiderAssigned, tripId, {
        tripId,
        matchingSessionId: session.id,
        customerId: trip.customerId,
        riderId,
        matchingDurationMs,
        ctx,
      });

      await this.options.tripGateway.transition(
        tripId,
        { toStatus: 'RIDER_ARRIVING', description: 'Rider is arriving' },
        ctx,
      );

      await this.options.sessionRepository.update(session.id, {
        status: 'ASSIGNED',
        assignedRiderId: riderId,
      });

      this.options.scheduler.cancel(tripId);
      await this.options.dispatchStore.clearSession(tripId);

      this.logger.info(
        {
          ...this.base(ctx, tripId),
          matchingSessionId: session.id,
          selectedRider: riderId,
          matchingDurationMs,
        },
        'rider assigned',
      );
    } finally {
      await this.options.lock.release(assignmentLock);
    }
  }

  private async handleRejection(
    session: MatchingSession,
    riderId: string,
    ctx: MatchingRequestContext,
  ): Promise<void> {
    await this.publish(KafkaTopics.TripRiderRejected, session.tripId, {
      tripId: session.tripId,
      matchingSessionId: session.id,
      riderId,
      ctx,
    });
    await this.rejectAndAdvance(session, riderId, ctx, 'rider rejected');
  }

  private async rejectAndAdvance(
    session: MatchingSession,
    riderId: string,
    ctx: MatchingRequestContext,
    reason: string,
  ): Promise<void> {
    await this.options.dispatchStore.clearPending(session.tripId, riderId);
    await this.options.dispatchStore.releaseRider(riderId);

    const pendingCount = await this.options.dispatchStore.getPendingCount(session.tripId);
    this.logger.info(
      { ...this.base(ctx, session.tripId), riderId, reason, pendingCount },
      'rider offer released',
    );

    if (pendingCount > 0) {
      return;
    }

    const trip = await this.options.tripGateway.getTrip(session.tripId);
    if (!trip || isTerminalStatus(trip.status as TripStatusValue)) {
      await this.cancelInternal(session, ctx);
      return;
    }

    await this.runDispatchCycle(session, trip, ctx);
  }

  /**
   * Finds and dispatches the next batch of eligible riders, expanding the search
   * radius when a radius is exhausted and failing when the maximum radius or the
   * session deadline is reached. Assumes the trip lock is held.
   */
  private async runDispatchCycle(
    session: MatchingSession,
    trip: Trip,
    ctx: MatchingRequestContext,
  ): Promise<MatchingSession> {
    if (Date.now() > session.expiresAt.getTime()) {
      return this.failMatching(session, trip, ctx, 'SEARCH_TIMEOUT');
    }

    const radii = this.options.config.searchRadiiMeters;
    let radiusIndex = Math.max(
      0,
      radii.findIndex((radius) => radius >= session.currentRadiusMeters),
    );
    let current = session;

    while (radiusIndex < radii.length) {
      const radius = radii[radiusIndex] ?? current.maxRadiusMeters;

      if (radius > current.currentRadiusMeters) {
        current = await this.options.sessionRepository.update(current.id, {
          currentRadiusMeters: radius,
        });
        await this.publish(KafkaTopics.TripSearchExpanded, trip.id, {
          tripId: trip.id,
          matchingSessionId: current.id,
          radiusMeters: radius,
          ctx,
        });
        this.logger.info(
          { ...this.base(ctx, trip.id), matchingSessionId: current.id, radiusMeters: radius },
          'search radius expanded',
        );
      }

      const candidates = await this.collectCandidates(current, trip, radius);
      const reserved = await this.reserveBatch(current, candidates);

      if (reserved.length > 0) {
        current = await this.dispatchBatch(current, trip, reserved, radius, ctx);
        return current;
      }

      radiusIndex += 1;
    }

    return this.failMatching(current, trip, ctx, 'NO_RIDERS_AVAILABLE');
  }

  private async collectCandidates(
    session: MatchingSession,
    trip: Trip,
    radiusMeters: number,
  ): Promise<RiderCandidate[]> {
    const offered = await this.options.dispatchStore.getOfferedRiders(trip.id);

    const nearby = await this.options.locationClient.findNearbyRiders({
      latitude: trip.pickupLatitude,
      longitude: trip.pickupLongitude,
      radiusMeters,
      vehicleType: trip.vehicleType,
      limit: this.options.config.maxCandidatesPerRadius,
      excludeRiderIds: offered,
    });

    const offeredSet = new Set(offered);
    const fresh = nearby.filter((rider) => !offeredSet.has(rider.riderId));
    const snapshots = await this.resolveSnapshots(fresh.map((rider) => rider.riderId));

    const candidates: RiderCandidate[] = [];
    for (const rider of fresh) {
      const snapshot = snapshots.get(rider.riderId);
      if (!snapshot) {
        continue;
      }
      if (!evaluateEligibility(snapshot, trip.vehicleType).eligible) {
        continue;
      }
      candidates.push({
        riderId: rider.riderId,
        distanceMeters: rider.distanceMeters,
        rating: snapshot.rating,
        activeTripCount: snapshot.activeTripCount,
        vehicleType: snapshot.primaryVehicleType ?? trip.vehicleType,
      });
    }

    const context: MatchingContext = {
      tripId: trip.id,
      vehicleType: trip.vehicleType,
      pickupLatitude: trip.pickupLatitude,
      pickupLongitude: trip.pickupLongitude,
    };
    return this.options.strategy.rank(candidates, context);
  }

  private async reserveBatch(
    session: MatchingSession,
    ranked: RiderCandidate[],
  ): Promise<RiderCandidate[]> {
    const reserved: RiderCandidate[] = [];
    for (const candidate of ranked) {
      if (reserved.length >= this.options.config.batchSize) {
        break;
      }
      const ok = await this.options.dispatchStore.reserveRider(
        session.tripId,
        candidate.riderId,
        this.options.config.dispatchTimeoutSeconds,
      );
      if (ok) {
        reserved.push(candidate);
      }
    }
    return reserved;
  }

  private async dispatchBatch(
    session: MatchingSession,
    trip: Trip,
    batch: RiderCandidate[],
    radiusMeters: number,
    ctx: MatchingRequestContext,
  ): Promise<MatchingSession> {
    for (const candidate of batch) {
      await this.options.dispatchStore.markPending(
        trip.id,
        candidate.riderId,
        this.options.config.dispatchTimeoutSeconds,
      );
      await this.publish(KafkaTopics.TripRiderNotified, trip.id, {
        tripId: trip.id,
        matchingSessionId: session.id,
        riderId: candidate.riderId,
        distanceMeters: candidate.distanceMeters,
        radiusMeters,
        dispatchTimeoutSeconds: this.options.config.dispatchTimeoutSeconds,
        ctx,
      });
    }

    const updated = await this.options.sessionRepository.update(session.id, {
      status: 'DISPATCHING',
      currentBatch: session.currentBatch + 1,
      currentRadiusMeters: radiusMeters,
    });
    await this.options.sessionRepository.incrementNotified(session.id, batch.length);

    this.options.scheduler.schedule(
      trip.id,
      this.options.config.dispatchTimeoutSeconds * 1000,
      () => this.handleDispatchTimeout(trip.id, ctx),
    );

    this.logger.info(
      {
        ...this.base(ctx, trip.id),
        matchingSessionId: session.id,
        batch: updated.currentBatch,
        radiusMeters,
        riders: batch.map((candidate) => candidate.riderId),
      },
      'dispatched rider batch',
    );

    return updated;
  }

  private async failMatching(
    session: MatchingSession,
    trip: Trip,
    ctx: MatchingRequestContext,
    reason: string,
  ): Promise<MatchingSession> {
    this.options.scheduler.cancel(trip.id);
    await this.options.dispatchStore.clearSession(trip.id);

    const current = await this.options.tripGateway.getTrip(trip.id);
    if (current && !isTerminalStatus(current.status as TripStatusValue)) {
      await this.options.tripGateway.transition(
        trip.id,
        { toStatus: 'FAILED', description: `Matching failed: ${reason}` },
        ctx,
      );
    }

    const updated = await this.options.sessionRepository.update(session.id, {
      status: 'FAILED',
      failureReason: reason,
    });

    await this.publish(KafkaTopics.TripSearchFailed, trip.id, {
      tripId: trip.id,
      matchingSessionId: session.id,
      customerId: trip.customerId,
      reason,
      notifiedRiderCount: updated.notifiedRiderCount,
      ctx,
    });

    this.logger.warn(
      {
        ...this.base(ctx, trip.id),
        matchingSessionId: session.id,
        reason,
        notifiedRiderCount: updated.notifiedRiderCount,
      },
      'matching failed',
    );

    return updated;
  }

  private async cancelInternal(
    session: MatchingSession,
    ctx: MatchingRequestContext,
  ): Promise<void> {
    this.options.scheduler.cancel(session.tripId);
    await this.options.dispatchStore.clearSession(session.tripId);
    await this.options.sessionRepository.update(session.id, { status: 'CANCELLED' });
    this.logger.info(
      { ...this.base(ctx, session.tripId), matchingSessionId: session.id },
      'matching cancelled',
    );
  }

  private async resolveSnapshots(
    riderIds: string[],
  ): Promise<Map<string, RiderEligibilitySnapshot>> {
    const result = new Map<string, RiderEligibilitySnapshot>();
    const misses: string[] = [];

    for (const riderId of riderIds) {
      const cached = await this.options.availabilityCache.get(riderId);
      if (cached) {
        result.set(riderId, cached);
      } else {
        misses.push(riderId);
      }
    }

    if (misses.length > 0) {
      const fetched = await this.options.riderClient.getEligibilityBatch(misses);
      for (const [riderId, snapshot] of fetched) {
        result.set(riderId, snapshot);
        await this.options.availabilityCache.set(
          riderId,
          snapshot,
          this.options.config.riderAvailabilityTtlSeconds,
        );
      }
    }

    return result;
  }

  private async resolveSnapshot(riderId: string): Promise<RiderEligibilitySnapshot | null> {
    const cached = await this.options.availabilityCache.get(riderId);
    if (cached) {
      return cached;
    }
    const snapshot = await this.options.riderClient.getEligibility(riderId);
    if (snapshot) {
      await this.options.availabilityCache.set(
        riderId,
        snapshot,
        this.options.config.riderAvailabilityTtlSeconds,
      );
    }
    return snapshot;
  }

  private async withTripLock(tripId: string, fn: () => Promise<void>): Promise<void> {
    const acquired = await this.options.lock.withLock(
      tripLockKey(tripId),
      this.options.config.lockTtlSeconds * 1000,
      fn,
    );
    if (acquired === null) {
      this.logger.info({ tripId }, 'matching skipped: trip is locked by another worker');
    }
  }

  private isActive(session: MatchingSession): boolean {
    return (ACTIVE_SESSION_STATUSES as readonly string[]).includes(session.status);
  }

  private async publish(
    topic: Parameters<MatchingEventPublisher['publish']>[0],
    key: string,
    payload: { ctx?: MatchingRequestContext } & Record<string, unknown>,
  ): Promise<void> {
    const { ctx, ...rest } = payload;
    await this.options.eventPublisher.publish(topic, key, {
      ...rest,
      requestId: ctx?.requestId,
      traceId: ctx?.traceId,
    });
  }

  private base(ctx: MatchingRequestContext, tripId: string): Record<string, unknown> {
    return {
      requestId: ctx.requestId,
      traceId: ctx.traceId,
      tripId,
    };
  }
}

function tripLockKey(tripId: string): string {
  return `trip-service:matching:lock:trip:${tripId}`;
}

function assignmentKey(riderId: string): string {
  return `trip-service:matching:lock:assign:${riderId}`;
}
