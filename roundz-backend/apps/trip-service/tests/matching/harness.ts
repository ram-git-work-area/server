import type { Trip, TripVehicleType } from '@prisma/client';
import { InMemoryDistributedLock } from '@roundz/redis';
import { NearestRiderStrategy } from '../../src/domain/matching/strategies';
import type {
  MatchingContext,
  RiderEligibilitySnapshot,
} from '../../src/domain/matching/matching-types';
import type { MatchingStrategy } from '../../src/domain/matching/matching-strategy';
import { InMemoryLocationClient, type SeededRider } from '../../src/clients/location.client';
import { InMemoryRiderClient } from '../../src/clients/rider.client';
import type {
  MatchingEventName,
  MatchingEventPublisher,
} from '../../src/events/matching-events.publisher';
import {
  MatchingEngine,
  type MatchingEngineConfig,
} from '../../src/services/matching/matching-engine.service';
import { ManualDispatchScheduler } from '../../src/services/matching/dispatch-scheduler';
import { MemoryDispatchStore } from '../../src/services/matching/dispatch.store';
import { MemoryRiderAvailabilityCache } from '../../src/services/matching/rider-availability.cache';
import { RepositoryTripGateway } from '../../src/services/matching/trip-gateway';
import { MemoryTripCache } from '../../src/services/trip-cache.service';
import { MemoryTripRepository } from '../memory-trip.repository';
import { MemoryMatchingSessionRepository } from './memory-matching-session.repository';

export class MemoryMatchingEventPublisher implements MatchingEventPublisher {
  public events: Array<{
    topic: MatchingEventName;
    key: string;
    payload: Record<string, unknown>;
  }> = [];

  async publish<TPayload extends Record<string, unknown>>(
    topic: MatchingEventName,
    key: string,
    payload: TPayload,
  ) {
    this.events.push({ topic, key, payload });
  }

  topics() {
    return this.events.map((event) => event.topic);
  }

  countOf(topic: MatchingEventName) {
    return this.events.filter((event) => event.topic === topic).length;
  }
}

export const testMatchingConfig: MatchingEngineConfig = {
  searchRadiiMeters: [2000, 5000, 10000],
  batchSize: 2,
  dispatchTimeoutSeconds: 15,
  sessionTtlSeconds: 180,
  lockTtlSeconds: 30,
  riderAvailabilityTtlSeconds: 30,
  maxCandidatesPerRadius: 50,
};

export function eligibleSnapshot(
  riderId: string,
  overrides: Partial<RiderEligibilitySnapshot> = {},
): RiderEligibilitySnapshot {
  return {
    riderId,
    status: 'ACTIVE',
    approvalStatus: 'APPROVED',
    onlineStatus: 'ONLINE',
    isBusy: false,
    hasActiveTrip: false,
    primaryVehicleType: 'CAR',
    hasCurrentLocation: true,
    rating: 4.5,
    activeTripCount: 0,
    ...overrides,
  };
}

export function nearbyRider(
  riderId: string,
  latitude: number,
  longitude: number,
  vehicleType: TripVehicleType = 'CAR',
): SeededRider {
  return { riderId, latitude, longitude, vehicleType };
}

export type Harness = {
  engine: MatchingEngine;
  trip: Trip;
  tripRepository: MemoryTripRepository;
  sessionRepository: MemoryMatchingSessionRepository;
  locationClient: InMemoryLocationClient;
  riderClient: InMemoryRiderClient;
  dispatchStore: MemoryDispatchStore;
  scheduler: ManualDispatchScheduler;
  events: MemoryMatchingEventPublisher;
  lock: InMemoryDistributedLock;
};

export type HarnessOptions = {
  strategy?: MatchingStrategy;
  config?: Partial<MatchingEngineConfig>;
  pickup?: { latitude: number; longitude: number };
  vehicleType?: TripVehicleType;
  riders?: SeededRider[];
  snapshots?: RiderEligibilitySnapshot[];
  lock?: InMemoryDistributedLock;
  dispatchStore?: MemoryDispatchStore;
};

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const pickup = options.pickup ?? { latitude: 12.9716, longitude: 77.5946 };
  const vehicleType = options.vehicleType ?? 'CAR';

  const tripRepository = new MemoryTripRepository();
  const sessionRepository = new MemoryMatchingSessionRepository();
  const tripCache = new MemoryTripCache();
  const events = new MemoryMatchingEventPublisher();
  const locationClient = new InMemoryLocationClient(options.riders ?? []);
  const riderClient = new InMemoryRiderClient(options.snapshots ?? []);
  const dispatchStore = options.dispatchStore ?? new MemoryDispatchStore();
  const availabilityCache = new MemoryRiderAvailabilityCache();
  const lock = options.lock ?? new InMemoryDistributedLock();
  const scheduler = new ManualDispatchScheduler();
  const config = { ...testMatchingConfig, ...options.config };

  const tripGateway = new RepositoryTripGateway(tripRepository, tripCache, events, 120);

  const trip = await tripRepository.createWithTimeline(
    {
      tripNumber: `TRP-TEST-${Math.random().toString(16).slice(2, 10)}`,
      customerId: 'customer-1',
      vehicleType,
      tripType: 'RIDE',
      pickupLatitude: pickup.latitude,
      pickupLongitude: pickup.longitude,
      pickupAddress: 'Pickup',
      dropLatitude: pickup.latitude + 0.05,
      dropLongitude: pickup.longitude + 0.05,
      dropAddress: 'Drop',
      estimatedDistance: 5,
      estimatedDuration: 600,
      estimatedFare: 120,
      paymentMethod: 'CASH',
    },
    'Trip requested',
  );

  const engine = new MatchingEngine({
    tripGateway,
    sessionRepository,
    locationClient,
    riderClient,
    availabilityCache,
    dispatchStore,
    lock,
    scheduler,
    eventPublisher: events,
    strategy: options.strategy ?? new NearestRiderStrategy(),
    config,
  });

  return {
    engine,
    trip,
    tripRepository,
    sessionRepository,
    locationClient,
    riderClient,
    dispatchStore,
    scheduler,
    events,
    lock,
  };
}

export const emptyContext: MatchingContext = {
  tripId: 'trip',
  vehicleType: 'CAR',
  pickupLatitude: 0,
  pickupLongitude: 0,
};
