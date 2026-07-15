import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '@roundz/auth';
import { registerErrorHandler } from '@roundz/errors';
import { userRoutes } from '../src/routes/user.routes';
import {
  MemoryObjectStorageProvider,
  MemoryUserCache,
  MemoryUserEventPublisher,
  MemoryUserRepository,
} from './memory-user.repository';

const jwtSecret = 'user-service-integration-secret';
const customerId = 'customer-integration-user';
const previousJwtSecret = process.env.JWT_SECRET;

describe('User Service routes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = jwtSecret;
    process.env.PORT = '3002';
  });

  afterEach(() => {
    process.env.JWT_SECRET = previousJwtSecret;
  });

  it('requires a CUSTOMER JWT for profile routes', async () => {
    const { app } = await createApp();
    const noToken = await app.inject({ method: 'GET', url: '/users/profile' });
    const riderToken = signAccessToken({ sub: 'rider-user', role: 'RIDER' }, jwtSecret);
    const rider = await app.inject({
      method: 'GET',
      url: '/users/profile',
      headers: { authorization: `Bearer ${riderToken}` },
    });

    expect(noToken.statusCode).toBe(401);
    expect(rider.statusCode).toBe(403);
    await app.close();
  });

  it('updates and retrieves a customer profile', async () => {
    const { app } = await createApp();
    const token = customerToken();
    const update = await app.inject({
      method: 'PUT',
      url: '/users/profile',
      headers: { authorization: `Bearer ${token}`, 'x-trace-id': 'trace-1' },
      payload: {
        firstName: 'Roundz',
        lastName: 'Customer',
        preferredLanguage: 'en',
      },
    });
    const get = await app.inject({
      method: 'GET',
      url: '/users/profile',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(update.statusCode).toBe(200);
    expect(get.statusCode).toBe(200);
    expect(get.json().data.firstName).toBe('Roundz');
    await app.close();
  });

  it('creates addresses and lists with cursor metadata', async () => {
    const { app } = await createApp();
    const token = customerToken();
    const create = await app.inject({
      method: 'POST',
      url: '/users/addresses',
      headers: { authorization: `Bearer ${token}` },
      payload: addressPayload('HOME', true),
    });
    const list = await app.inject({
      method: 'GET',
      url: '/users/addresses?limit=10',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(create.statusCode).toBe(201);
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
    expect(list.json().meta.pagination.hasMore).toBe(false);
    await app.close();
  });

  it('creates, updates, and deletes favorite locations', async () => {
    const { app } = await createApp();
    const token = customerToken();
    const create = await app.inject({
      method: 'POST',
      url: '/users/favorites',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Airport',
        address: 'Airport Road',
        latitude: 12.95,
        longitude: 77.65,
      },
    });
    const favoriteId = create.json().data.id;
    const update = await app.inject({
      method: 'PUT',
      url: `/users/favorites/${favoriteId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Airport Terminal' },
    });
    const deletion = await app.inject({
      method: 'DELETE',
      url: `/users/favorites/${favoriteId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(create.statusCode).toBe(201);
    expect(update.statusCode).toBe(200);
    expect(update.json().data.name).toBe('Airport Terminal');
    expect(deletion.statusCode).toBe(200);
    await app.close();
  });

  it('updates settings and emergency contact', async () => {
    const { app } = await createApp();
    const token = customerToken();
    const settings = await app.inject({
      method: 'PATCH',
      url: '/users/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        darkModeEnabled: true,
        language: 'hi-IN',
        timezone: 'Asia/Kolkata',
      },
    });
    const emergency = await app.inject({
      method: 'PATCH',
      url: '/users/emergency-contact',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        emergencyContactName: 'Family',
        emergencyContactPhone: '+15550001111',
      },
    });

    expect(settings.statusCode).toBe(200);
    expect(settings.json().data.darkModeEnabled).toBe(true);
    expect(emergency.statusCode).toBe(200);
    expect(emergency.json().data.emergencyContactName).toBe('Family');
    await app.close();
  });
});

async function createApp() {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(userRoutes, {
    repository: new MemoryUserRepository(),
    cache: new MemoryUserCache(),
    eventPublisher: new MemoryUserEventPublisher(),
    storageProvider: new MemoryObjectStorageProvider(),
  });
  await app.ready();
  return { app };
}

function customerToken() {
  return signAccessToken({ sub: customerId, role: 'CUSTOMER' }, jwtSecret);
}

function addressPayload(label: 'HOME' | 'WORK', isDefault: boolean) {
  return {
    label,
    addressLine1: `${label} line 1`,
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    postalCode: '560001',
    latitude: 12.9716,
    longitude: 77.5946,
    isDefault,
  };
}
