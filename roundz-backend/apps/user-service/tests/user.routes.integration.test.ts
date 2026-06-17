import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '@roundz/auth';
import { userRoutes } from '../src/routes/user.routes';
import {
  MemoryObjectStorageProvider,
  MemoryUserEventPublisher,
  MemoryUserRepository,
} from './memory-user.repository';

const jwtSecret = 'user-service-integration-secret';
const customerId = 'customer-integration-user';

describe('user routes integration', () => {
  const previousJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = jwtSecret;
  });

  afterEach(() => {
    process.env.JWT_SECRET = previousJwtSecret;
  });

  it('updates and retrieves an authenticated customer profile', async () => {
    const { app } = await createApp();
    const token = customerToken();

    const updateResponse = await app.inject({
      method: 'PUT',
      url: '/users/profile',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        firstName: 'Roundz',
        lastName: 'Customer',
      },
    });
    const getResponse = await app.inject({
      method: 'GET',
      url: '/users/profile',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().data.firstName).toBe('Roundz');

    await app.close();
  });

  it('creates and lists saved addresses with pagination metadata', async () => {
    const { app } = await createApp();
    const token = customerToken();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/users/addresses',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        label: 'HOME',
        address: '123 Roundz Street',
        latitude: 12.9,
        longitude: 77.6,
        isDefault: true,
      },
    });
    const listResponse = await app.inject({
      method: 'GET',
      url: '/users/addresses?page=1&limit=10',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().data).toHaveLength(1);
    expect(listResponse.json().meta.pagination.total).toBe(1);

    await app.close();
  });

  it('rejects non-customer access tokens', async () => {
    const { app } = await createApp();
    const token = signAccessToken(
      {
        sub: 'rider-user',
        role: 'RIDER',
      },
      jwtSecret,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/users/profile',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(403);

    await app.close();
  });
});

async function createApp() {
  const app = Fastify({ logger: false });
  const repository = new MemoryUserRepository();
  const storageProvider = new MemoryObjectStorageProvider();
  const eventPublisher = new MemoryUserEventPublisher();

  await app.register(userRoutes, {
    repository,
    storageProvider,
    eventPublisher,
  });
  await app.ready();

  return { app, repository, storageProvider, eventPublisher };
}

function customerToken() {
  return signAccessToken(
    {
      sub: customerId,
      role: 'CUSTOMER',
    },
    jwtSecret,
  );
}
