import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '@roundz/auth';
import { registerErrorHandler } from '@roundz/errors';
import { locationRoutes } from '../src/routes/location.routes';
import { BatchingHistoryWriter } from '../src/services/history-writer';
import {
  MemoryLocationCache,
  MemoryLocationEventPublisher,
  MemoryLocationRepository,
} from './memory-location.repository';

const jwtSecret = 'location-service-integration-secret';
const riderUserId = 'rider-integration-user';
const previousJwtSecret = process.env.JWT_SECRET;

describe('Location Service routes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = jwtSecret;
    process.env.PORT = '3007';
  });

  afterEach(() => {
    process.env.JWT_SECRET = previousJwtSecret;
  });

  it('enforces authentication and role for the update endpoint', async () => {
    const { app } = await createApp();
    const noToken = await app.inject({
      method: 'POST',
      url: '/location/update',
      payload: { latitude: 12.9716, longitude: 77.5946 },
    });
    const customer = await app.inject({
      method: 'POST',
      url: '/location/update',
      headers: { authorization: `Bearer ${token('CUSTOMER', 'customer-1')}` },
      payload: { latitude: 12.9716, longitude: 77.5946 },
    });

    expect(noToken.statusCode).toBe(401);
    expect(customer.statusCode).toBe(403);
    await app.close();
  });

  it('accepts a location update and returns the current location', async () => {
    const { app } = await createApp();
    const auth = { authorization: `Bearer ${token('RIDER', riderUserId)}` };
    const update = await app.inject({
      method: 'POST',
      url: '/location/update',
      headers: auth,
      payload: { latitude: 12.9716, longitude: 77.5946, speed: 8, source: 'GPS' },
    });
    const current = await app.inject({ method: 'GET', url: '/location/current', headers: auth });

    expect(update.statusCode).toBe(200);
    expect(update.json().data.accepted).toBe(true);
    expect(current.statusCode).toBe(200);
    expect(current.json().data.onlineStatus).toBe('ONLINE');
    await app.close();
  });

  it('rejects invalid coordinates with a validation error', async () => {
    const { app } = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/location/update',
      headers: { authorization: `Bearer ${token('RIDER', riderUserId)}` },
      payload: { latitude: 200, longitude: 77.5946 },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns nearby riders for an authenticated customer', async () => {
    const { app, repository } = await createApp();
    await repository.upsertCurrent('rider-near', current(12.9716, 77.5946));
    await repository.upsertCurrent('rider-far', current(13.3, 78.0));

    const response = await app.inject({
      method: 'GET',
      url: '/location/nearby?latitude=12.9716&longitude=77.5946&radius=3000&onlineOnly=true',
      headers: { authorization: `Bearer ${token('CUSTOMER', 'customer-1')}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((rider: { riderId: string }) => rider.riderId)).toEqual([
      'rider-near',
    ]);
    await app.close();
  });

  it('restricts another rider lookup to admin/support roles', async () => {
    const { app, repository } = await createApp();
    const targetRiderId = '33333333-3333-4333-8333-333333333333';
    await repository.upsertCurrent(targetRiderId, current(12.9716, 77.5946));

    const asRider = await app.inject({
      method: 'GET',
      url: '/location/rider/11111111-1111-4111-8111-111111111111',
      headers: { authorization: `Bearer ${token('RIDER', riderUserId)}` },
    });
    const asAdmin = await app.inject({
      method: 'GET',
      url: `/location/rider/${targetRiderId}`,
      headers: { authorization: `Bearer ${token('ADMIN', 'admin-1')}` },
    });

    expect(asRider.statusCode).toBe(403);
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json().data.riderId).toBe(targetRiderId);
    await app.close();
  });

  it('returns location history for the authenticated rider', async () => {
    const { app } = await createApp();
    const auth = { authorization: `Bearer ${token('RIDER', riderUserId)}` };
    await app.inject({
      method: 'POST',
      url: '/location/update',
      headers: auth,
      payload: { latitude: 12.9716, longitude: 77.5946, source: 'GPS' },
    });

    const history = await app.inject({
      method: 'GET',
      url: '/location/history?limit=10',
      headers: auth,
    });

    expect(history.statusCode).toBe(200);
    expect(history.json().data).toHaveLength(1);
    expect(history.json().data[0].riderId).toBe(riderUserId);
    await app.close();
  });
});

async function createApp() {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const repository = new MemoryLocationRepository();
  const historyWriter = new BatchingHistoryWriter(repository, {
    batchSize: 1,
    flushIntervalMs: 1_000_000,
  });
  await app.register(locationRoutes, {
    repository,
    cache: new MemoryLocationCache(),
    eventPublisher: new MemoryLocationEventPublisher(),
    historyWriter,
  });
  await app.ready();
  return { app, repository };
}

function token(role: 'CUSTOMER' | 'RIDER' | 'ADMIN' | 'SUPPORT', sub: string) {
  return signAccessToken({ sub, role }, jwtSecret);
}

function current(latitude: number, longitude: number) {
  return {
    latitude,
    longitude,
    heading: null,
    speed: null,
    accuracy: null,
    altitude: null,
    vehicleType: 'BIKE' as string | null,
    onlineStatus: 'ONLINE' as const,
    lastUpdatedAt: new Date(),
  };
}
