import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken, type AuthRole, type AuthTokenPayload } from '@roundz/auth';
import { registerErrorHandler } from '@roundz/errors';
import { tripRoutes } from '../src/routes/trip.routes';
import { MemoryTripEventPublisher, MemoryTripRepository } from './memory-trip.repository';
import { MemoryTripCache } from '../src/services/trip-cache.service';

const jwtSecret = 'trip-service-integration-secret';
const customerId = 'customer-integration-user';
const previousJwtSecret = process.env.JWT_SECRET;

describe('Trip Service routes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = jwtSecret;
    process.env.PORT = '3004';
  });

  afterEach(() => {
    process.env.JWT_SECRET = previousJwtSecret;
  });

  it('enforces authentication and CUSTOMER role for trip creation', async () => {
    const { app } = await createApp();
    const noToken = await app.inject({ method: 'POST', url: '/trips', payload: tripPayload() });
    const rider = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: auth('RIDER', 'rider-1'),
      payload: tripPayload(),
    });

    expect(noToken.statusCode).toBe(401);
    expect(rider.statusCode).toBe(403);
    await app.close();
  });

  it('creates a trip and rejects a second active trip', async () => {
    const { app } = await createApp();
    const first = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: auth('CUSTOMER', customerId),
      payload: tripPayload(),
    });
    const second = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: auth('CUSTOMER', customerId),
      payload: tripPayload(),
    });

    expect(first.statusCode).toBe(201);
    expect(first.json().data.status).toBe('REQUESTED');
    expect(second.statusCode).toBe(409);
    await app.close();
  });

  it('rejects identical pickup and drop with a validation error', async () => {
    const { app } = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: auth('CUSTOMER', customerId),
      payload: tripPayload({ dropLatitude: 12.9716, dropLongitude: 77.5946 }),
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('enforces ownership on trip reads', async () => {
    const { app } = await createApp();
    const created = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: auth('CUSTOMER', customerId),
      payload: tripPayload(),
    });
    const tripId = created.json().data.id;

    const owner = await app.inject({
      method: 'GET',
      url: `/trips/${tripId}`,
      headers: auth('CUSTOMER', customerId),
    });
    const other = await app.inject({
      method: 'GET',
      url: `/trips/${tripId}`,
      headers: auth('CUSTOMER', 'another-customer'),
    });
    const admin = await app.inject({
      method: 'GET',
      url: `/trips/${tripId}`,
      headers: auth('ADMIN', 'admin-1'),
    });

    expect(owner.statusCode).toBe(200);
    expect(other.statusCode).toBe(403);
    expect(admin.statusCode).toBe(200);
    await app.close();
  });

  it('lists and cancels trips for the owner', async () => {
    const { app } = await createApp();
    const created = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: auth('CUSTOMER', customerId),
      payload: tripPayload(),
    });
    const tripId = created.json().data.id;

    const list = await app.inject({
      method: 'GET',
      url: '/trips?limit=10',
      headers: auth('CUSTOMER', customerId),
    });
    const cancel = await app.inject({
      method: 'PATCH',
      url: `/trips/${tripId}/cancel`,
      headers: auth('CUSTOMER', customerId),
      payload: { reason: 'changed my mind' },
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
    expect(list.json().meta.pagination.hasMore).toBe(false);
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().data.status).toBe('CANCELLED');
    await app.close();
  });

  it('restricts the internal status endpoint and validates transitions', async () => {
    const { app } = await createApp();
    const created = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: auth('CUSTOMER', customerId),
      payload: tripPayload(),
    });
    const tripId = created.json().data.id;

    const asCustomer = await app.inject({
      method: 'PATCH',
      url: `/trips/${tripId}/status`,
      headers: auth('CUSTOMER', customerId),
      payload: { status: 'SEARCHING_RIDER' },
    });
    const asService = await app.inject({
      method: 'PATCH',
      url: `/trips/${tripId}/status`,
      headers: serviceAuth(),
      payload: { status: 'SEARCHING_RIDER' },
    });
    const invalid = await app.inject({
      method: 'PATCH',
      url: `/trips/${tripId}/status`,
      headers: auth('ADMIN', 'admin-1'),
      payload: { status: 'COMPLETED' },
    });

    expect(asCustomer.statusCode).toBe(403);
    expect(asService.statusCode).toBe(200);
    expect(asService.json().data.status).toBe('SEARCHING_RIDER');
    expect(invalid.statusCode).toBe(409);
    await app.close();
  });
});

async function createApp() {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const repository = new MemoryTripRepository();
  await app.register(tripRoutes, {
    repository,
    cache: new MemoryTripCache(),
    eventPublisher: new MemoryTripEventPublisher(),
  });
  await app.ready();
  return { app, repository };
}

function token(payload: AuthTokenPayload) {
  return signAccessToken(payload, jwtSecret);
}

function auth(role: AuthRole, sub: string) {
  return { authorization: `Bearer ${token({ sub, role })}` };
}

function serviceAuth() {
  return {
    authorization: `Bearer ${token({ sub: 'matching-engine', role: 'CUSTOMER', service: 'matching-engine' })}`,
  };
}

function tripPayload(overrides: Record<string, unknown> = {}) {
  return {
    vehicleType: 'BIKE',
    tripType: 'RIDE',
    pickupLatitude: 12.9716,
    pickupLongitude: 77.5946,
    pickupAddress: 'MG Road, Bengaluru',
    dropLatitude: 12.9352,
    dropLongitude: 77.6245,
    dropAddress: 'Koramangala, Bengaluru',
    estimatedDistance: 6500,
    estimatedDuration: 1200,
    estimatedFare: 145.5,
    paymentMethod: 'CASH',
    ...overrides,
  };
}
