import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken, type AuthRole } from '@roundz/auth';
import { registerErrorHandler } from '@roundz/errors';
import { matchingRoutes } from '../../src/routes/matching.routes';
import { MatchingService } from '../../src/services/matching/matching.service';
import { createHarness, eligibleSnapshot, nearbyRider } from './harness';

const jwtSecret = 'matching-integration-secret';
const previousJwtSecret = process.env.JWT_SECRET;
const PICKUP = { latitude: 12.9716, longitude: 77.5946 };
const NEAR = PICKUP.latitude + 0.002;

describe('Matching Service internal routes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = jwtSecret;
    process.env.PORT = '3004';
  });

  afterEach(() => {
    process.env.JWT_SECRET = previousJwtSecret;
  });

  it('requires an internal caller (rejects anonymous and customer callers)', async () => {
    const { app, tripId } = await buildApp();

    const anon = await app.inject({ method: 'POST', url: `/internal/trips/${tripId}/match` });
    const customer = await app.inject({
      method: 'POST',
      url: `/internal/trips/${tripId}/match`,
      headers: auth('CUSTOMER', 'customer-1'),
    });

    expect(anon.statusCode).toBe(401);
    expect(customer.statusCode).toBe(403);
    await app.close();
  });

  it('starts matching for a privileged caller and reports session status', async () => {
    const { app, tripId } = await buildApp();

    const started = await app.inject({
      method: 'POST',
      url: `/internal/trips/${tripId}/match`,
      headers: auth('ADMIN', 'admin-1'),
    });

    expect(started.statusCode).toBe(202);
    expect(started.json().data.tripId).toBe(tripId);
    expect(['SEARCHING', 'DISPATCHING']).toContain(started.json().data.status);

    const status = await app.inject({
      method: 'GET',
      url: `/internal/trips/${tripId}/matching`,
      headers: auth('ADMIN', 'admin-1'),
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.notifiedRiderCount).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it('returns 404 when no matching session exists for the trip', async () => {
    const { app } = await buildApp();
    const unknownTripId = '11111111-1111-4111-8111-111111111111';

    const response = await app.inject({
      method: 'GET',
      url: `/internal/trips/${unknownTripId}/matching`,
      headers: auth('SUPPORT', 'support-1'),
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('accepts a service-token caller', async () => {
    const { app, tripId } = await buildApp();
    const token = signAccessToken({ sub: 'svc', role: 'ADMIN', service: 'gateway' }, jwtSecret);

    const response = await app.inject({
      method: 'GET',
      url: `/internal/trips/${tripId}/matching`,
      headers: { authorization: `Bearer ${token}` },
    });
    // No session yet (matching not started) -> 404, but auth passed.
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

async function buildApp() {
  const harness = await createHarness({
    pickup: PICKUP,
    riders: [nearbyRider('rA', NEAR, PICKUP.longitude)],
    snapshots: [eligibleSnapshot('rA')],
  });
  const service = new MatchingService(harness.engine);

  const app = Fastify();
  registerErrorHandler(app);
  await app.register(matchingRoutes, { service });
  await app.ready();

  return { app, tripId: harness.trip.id };
}

function auth(role: AuthRole, sub: string) {
  const token = signAccessToken({ sub, role }, jwtSecret);
  return { authorization: `Bearer ${token}` };
}
