import { describe, expect, it } from 'vitest';
import { MemoryLocationRepository } from './memory-location.repository';

function baseCurrent(overrides: Record<string, unknown> = {}) {
  return {
    latitude: 12.9716,
    longitude: 77.5946,
    heading: null,
    speed: null,
    accuracy: null,
    altitude: null,
    vehicleType: 'BIKE' as string | null,
    onlineStatus: 'ONLINE' as const,
    lastUpdatedAt: new Date(),
    ...overrides,
  };
}

describe('LocationRepository behavior', () => {
  it('upserts and replaces the current location for a rider', async () => {
    const repository = new MemoryLocationRepository();
    await repository.upsertCurrent('rider-1', baseCurrent());
    const updated = await repository.upsertCurrent(
      'rider-1',
      baseCurrent({ latitude: 13.0, longitude: 77.7 }),
    );

    expect(repository.current.size).toBe(1);
    expect(updated.latitude).toBe(13.0);
  });

  it('only marks online riders offline', async () => {
    const repository = new MemoryLocationRepository();
    await repository.upsertCurrent('online', baseCurrent());
    await repository.upsertCurrent('offline', baseCurrent({ onlineStatus: 'OFFLINE' }));

    expect(await repository.setOffline('online')).not.toBeNull();
    expect(await repository.setOffline('offline')).toBeNull();
  });

  it('returns nearby riders within the radius sorted by distance (geospatial)', async () => {
    const repository = new MemoryLocationRepository();
    await repository.upsertCurrent('here', baseCurrent({ latitude: 12.9716, longitude: 77.5946 }));
    await repository.upsertCurrent('close', baseCurrent({ latitude: 12.9726, longitude: 77.5956 }));
    await repository.upsertCurrent('far', baseCurrent({ latitude: 13.2, longitude: 77.9 }));

    const results = await repository.findNearby({
      latitude: 12.9716,
      longitude: 77.5946,
      radiusMeters: 3000,
      onlineOnly: true,
      limit: 10,
    });

    expect(results.map((rider) => rider.riderId)).toEqual(['here', 'close']);
    expect(results[0]!.distanceMeters).toBe(0);
  });

  it('filters nearby riders by vehicle type and online status', async () => {
    const repository = new MemoryLocationRepository();
    await repository.upsertCurrent('bike', baseCurrent({ vehicleType: 'BIKE' }));
    await repository.upsertCurrent('car', baseCurrent({ vehicleType: 'CAR' }));
    await repository.upsertCurrent(
      'offline-bike',
      baseCurrent({ vehicleType: 'BIKE', onlineStatus: 'OFFLINE' }),
    );

    const results = await repository.findNearby({
      latitude: 12.9716,
      longitude: 77.5946,
      radiusMeters: 5000,
      vehicleType: 'BIKE',
      onlineOnly: true,
      limit: 10,
    });

    expect(results.map((rider) => rider.riderId)).toEqual(['bike']);
  });

  it('finds stale online riders older than a threshold', async () => {
    const repository = new MemoryLocationRepository();
    await repository.upsertCurrent(
      'stale',
      baseCurrent({ lastUpdatedAt: new Date(Date.now() - 60_000) }),
    );
    await repository.upsertCurrent('fresh', baseCurrent({ lastUpdatedAt: new Date() }));

    const stale = await repository.findStaleOnline(new Date(Date.now() - 30_000), 100);
    expect(stale.map((rider) => rider.riderId)).toEqual(['stale']);
  });

  it('lists history newest-first and filters by trip', async () => {
    const repository = new MemoryLocationRepository();
    await repository.appendHistoryMany([
      historyInput('rider-1', 'trip-1', new Date(Date.UTC(2026, 0, 1, 0, 0, 1))),
      historyInput('rider-1', 'trip-1', new Date(Date.UTC(2026, 0, 1, 0, 0, 2))),
      historyInput('rider-1', null, new Date(Date.UTC(2026, 0, 1, 0, 0, 3))),
    ]);

    const tripHistory = await repository.listHistory({
      riderId: 'rider-1',
      tripId: 'trip-1',
      limit: 10,
    });
    expect(tripHistory).toHaveLength(2);
    expect(tripHistory[0]!.timestamp.getTime()).toBeGreaterThan(
      tripHistory[1]!.timestamp.getTime(),
    );
  });
});

function historyInput(riderId: string, tripId: string | null, timestamp: Date) {
  return {
    riderId,
    tripId,
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
