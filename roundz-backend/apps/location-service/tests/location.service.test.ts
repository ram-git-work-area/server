import { describe, expect, it } from 'vitest';
import { KafkaTopics } from '@roundz/kafka';
import { BatchingHistoryWriter } from '../src/services/history-writer';
import { LocationService } from '../src/services/location.service';
import type { UpdateLocationRequest } from '../src/schemas/location.schemas';
import {
  MemoryLocationCache,
  MemoryLocationEventPublisher,
  MemoryLocationRepository,
} from './memory-location.repository';

const riderId = 'rider-1';
const context = { requestId: 'unit-request', traceId: 'unit-trace' };

describe('LocationService', () => {
  it('accepts a first update, sets ONLINE, writes history, and emits events', async () => {
    const { service, repository, events } = createService();
    const result = await service.updateLocation(riderId, update({ timestamp: at(0) }), context);

    expect(result.data.accepted).toBe(true);
    expect(result.data.location.onlineStatus).toBe('ONLINE');
    expect(repository.history).toHaveLength(1);
    expect(events.topics()).toContain(KafkaTopics.LocationUpdated);
    expect(events.topics()).toContain(KafkaTopics.LocationOnline);
  });

  it('emits location.online only on the offline→online transition', async () => {
    const { service, events } = createService();
    await service.updateLocation(riderId, update({ timestamp: at(0) }), context);
    await service.updateLocation(
      riderId,
      update({ latitude: 12.9721, longitude: 77.5951, timestamp: at(60) }),
      context,
    );

    const onlineEvents = events.topics().filter((topic) => topic === KafkaTopics.LocationOnline);
    expect(onlineEvents).toHaveLength(1);
  });

  it('rejects stale (out-of-order) updates and emits location.stale', async () => {
    const { service, repository, events } = createService();
    await service.updateLocation(riderId, update({ timestamp: at(10) }), context);
    const result = await service.updateLocation(riderId, update({ timestamp: at(5) }), context);

    expect(result.data.accepted).toBe(false);
    expect(result.data.reason).toBe('stale');
    expect(repository.history).toHaveLength(1);
    expect(events.topics()).toContain(KafkaTopics.LocationStale);
  });

  it('ignores duplicate GPS updates but keeps presence alive with a heartbeat', async () => {
    const { service, repository, events } = createService();
    await service.updateLocation(riderId, update({ timestamp: at(0) }), context);
    const result = await service.updateLocation(riderId, update({ timestamp: at(5) }), context);

    expect(result.data.accepted).toBe(false);
    expect(result.data.reason).toBe('duplicate');
    expect(repository.history).toHaveLength(1);
    expect(events.topics()).toContain(KafkaTopics.LocationHeartbeat);
  });

  it('rejects impossible reported speeds', async () => {
    const { service } = createService();
    await expect(
      service.updateLocation(riderId, update({ speed: 500, timestamp: at(0) }), context),
    ).rejects.toMatchObject({ code: 'LOCATION_IMPOSSIBLE_SPEED' });
  });

  it('rejects impossible implied speeds (teleports)', async () => {
    const { service } = createService();
    await service.updateLocation(riderId, update({ timestamp: at(0) }), context);
    await expect(
      service.updateLocation(
        riderId,
        update({ latitude: 13.9716, longitude: 78.5946, timestamp: at(1) }),
        context,
      ),
    ).rejects.toMatchObject({ code: 'LOCATION_IMPOSSIBLE_SPEED' });
  });

  it('rejects invalid coordinates', async () => {
    const { service } = createService();
    await expect(
      service.updateLocation(
        riderId,
        { latitude: 200, longitude: 0, source: 'GPS' } as UpdateLocationRequest,
        context,
      ),
    ).rejects.toMatchObject({ code: 'LOCATION_INVALID_COORDINATES' });
  });

  it('returns 404 when no current location exists', async () => {
    const { service } = createService();
    await expect(service.getCurrent('missing-rider')).rejects.toMatchObject({
      code: 'LOCATION_NOT_FOUND',
    });
  });

  it('returns nearby riders sorted by distance with online and vehicle filters', async () => {
    const { service, repository } = createService();
    await seedCurrent(repository, 'near', 12.9716, 77.5946, 'ONLINE', 'BIKE');
    await seedCurrent(repository, 'far', 12.99, 77.62, 'ONLINE', 'BIKE');
    await seedCurrent(repository, 'offline', 12.9717, 77.5947, 'OFFLINE', 'BIKE');
    await seedCurrent(repository, 'car', 12.9718, 77.5948, 'ONLINE', 'CAR');

    const result = await service.getNearby({
      latitude: 12.9716,
      longitude: 77.5946,
      radius: 5000,
      onlineOnly: true,
      vehicleType: 'BIKE',
    });

    expect(result.data.map((rider) => rider.riderId)).toEqual(['near', 'far']);
    expect(result.data[0]!.distanceMeters).toBeLessThanOrEqual(result.data[1]!.distanceMeters);
  });

  it('paginates history with an opaque cursor', async () => {
    const { service, repository } = createService();
    for (let i = 0; i < 5; i += 1) {
      await repository.appendHistoryMany([historyInput(riderId, at(i))]);
    }

    const first = await service.getHistory({ limit: 2 }, riderId, false);
    expect(first.data).toHaveLength(2);
    expect(first.meta.pagination.hasMore).toBe(true);

    const second = await service.getHistory(
      { limit: 2, cursor: first.meta.pagination.nextCursor! },
      riderId,
      false,
    );
    expect(second.data).toHaveLength(2);
    expect(second.data[0]!.id).not.toBe(first.data[0]!.id);
  });

  it('forbids a rider from reading another rider history', async () => {
    const { service } = createService();
    await expect(
      service.getHistory({ limit: 10, riderId: 'someone-else' }, riderId, false),
    ).rejects.toMatchObject({ code: 'LOCATION_FORBIDDEN' });
  });

  it('sweeps stale presence to OFFLINE and emits location.offline', async () => {
    const { service, repository, events } = createService();
    await repository.upsertCurrent('stale-rider', {
      latitude: 12.9716,
      longitude: 77.5946,
      heading: null,
      speed: null,
      accuracy: null,
      altitude: null,
      vehicleType: 'BIKE',
      onlineStatus: 'ONLINE',
      lastUpdatedAt: new Date(Date.now() - 60_000),
    });

    const swept = await service.sweepStalePresence(context);
    const offline = await repository.getCurrent('stale-rider');

    expect(swept).toBe(1);
    expect(offline?.onlineStatus).toBe('OFFLINE');
    expect(events.topics()).toContain(KafkaTopics.LocationOffline);
  });
});

function createService() {
  const repository = new MemoryLocationRepository();
  const cache = new MemoryLocationCache();
  const events = new MemoryLocationEventPublisher();
  const historyWriter = new BatchingHistoryWriter(repository, {
    batchSize: 1,
    flushIntervalMs: 1_000_000,
  });
  const service = new LocationService({
    repository,
    cache,
    eventPublisher: events,
    historyWriter,
    config: {
      maxSpeedMps: 90,
      duplicateEpsilonMeters: 2,
      presenceTimeoutSeconds: 30,
      currentCacheTtlSeconds: 10,
      nearbyMaxRadiusMeters: 50000,
      nearbyDefaultLimit: 50,
      sweepBatchSize: 100,
    },
  });

  return { service, repository, cache, events, historyWriter };
}

function update(overrides: Partial<UpdateLocationRequest> = {}): UpdateLocationRequest {
  return {
    latitude: 12.9716,
    longitude: 77.5946,
    source: 'GPS',
    ...overrides,
  };
}

function at(secondsFromBase: number) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, secondsFromBase));
}

async function seedCurrent(
  repository: MemoryLocationRepository,
  id: string,
  latitude: number,
  longitude: number,
  onlineStatus: 'ONLINE' | 'OFFLINE',
  vehicleType: string,
) {
  await repository.upsertCurrent(id, {
    latitude,
    longitude,
    heading: null,
    speed: null,
    accuracy: null,
    altitude: null,
    vehicleType,
    onlineStatus,
    lastUpdatedAt: new Date(),
  });
}

function historyInput(rider: string, timestamp: Date) {
  return {
    riderId: rider,
    tripId: null,
    latitude: 12.9716,
    longitude: 77.5946,
    heading: null,
    speed: null,
    accuracy: null,
    altitude: null,
    source: 'GPS' as const,
    timestamp,
  };
}
