import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '@roundz/auth';
import { buildApp } from '../src/app';

const jwtSecret = 'gateway-integration-secret';
const originalEnv = { ...process.env };

describe('api gateway integration', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('forwards authenticated user requests and propagates identity headers', async () => {
    const userService = Fastify();
    userService.get('/health/ready', async () => ({ status: 'ok' }));
    userService.get('/users/profile', async (request) => ({
      data: {
        userId: request.headers['x-user-id'],
        role: request.headers['x-user-role'],
        requestId: request.headers['x-request-id'],
      },
    }));
    const userUrl = await listen(userService);
    const { app } = await createGateway({ USER_SERVICE_URL: userUrl });
    const response = await app.inject({
      method: 'GET',
      url: '/api/users/profile',
      headers: {
        authorization: `Bearer ${customerToken()}`,
        'x-request-id': 'test-request-id',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      userId: 'customer-user',
      role: 'CUSTOMER',
      requestId: 'test-request-id',
    });

    await app.close();
    await userService.close();
  });

  it('forwards public auth routes without requiring JWT', async () => {
    const authService = Fastify();
    authService.post('/auth/login', async (request) => ({
      data: {
        receivedAuthorization: request.headers.authorization ?? null,
      },
    }));
    authService.get('/health/ready', async () => ({ status: 'ok' }));
    const authUrl = await listen(authService);
    const { app } = await createGateway({ AUTH_SERVICE_URL: authUrl });
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'customer@example.com',
        password: 'password123',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.receivedAuthorization).toBeNull();

    await app.close();
    await authService.close();
  });

  it('retries GET requests but not POST requests', async () => {
    let getAttempts = 0;
    let postAttempts = 0;
    const userService = Fastify();
    userService.get('/users/retry', async (_request, reply) => {
      getAttempts += 1;
      if (getAttempts === 1) {
        return reply.code(503).send({ error: 'temporary' });
      }

      return { data: { ok: true, attempts: getAttempts } };
    });
    userService.post('/users/retry', async (_request, reply) => {
      postAttempts += 1;
      return reply.code(503).send({ error: 'temporary' });
    });
    userService.get('/health/ready', async () => ({ status: 'ok' }));
    const userUrl = await listen(userService);
    const { app } = await createGateway({
      USER_SERVICE_URL: userUrl,
      GATEWAY_GET_RETRY_ATTEMPTS: '1',
    });

    const getResponse = await app.inject({
      method: 'GET',
      url: '/api/users/retry',
      headers: {
        authorization: `Bearer ${customerToken()}`,
      },
    });
    const postResponse = await app.inject({
      method: 'POST',
      url: '/api/users/retry',
      headers: {
        authorization: `Bearer ${customerToken()}`,
      },
      payload: {
        test: true,
      },
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().data.attempts).toBe(2);
    expect(postResponse.statusCode).toBe(503);
    expect(postAttempts).toBe(1);

    await app.close();
    await userService.close();
  });

  it('returns service health and exposes metrics', async () => {
    const userService = Fastify();
    userService.get('/health/ready', async () => ({ status: 'ok' }));
    const userUrl = await listen(userService);
    const { app } = await createGateway({ USER_SERVICE_URL: userUrl });

    const healthResponse = await app.inject('/health/services');
    const metricsResponse = await app.inject('/metrics');

    expect(healthResponse.statusCode).toBe(200);
    expect(
      healthResponse
        .json()
        .services.some(
          (service: { service: string; status: string }) =>
            service.service === 'user-service' && service.status === 'up',
        ),
    ).toBe(true);
    expect(metricsResponse.statusCode).toBe(200);
    expect(metricsResponse.body).toContain('roundz_gateway_requests_total');

    await app.close();
    await userService.close();
  });

  it('opens a circuit for an unavailable service', async () => {
    const { app } = await createGateway({
      USER_SERVICE_URL: 'http://127.0.0.1:9',
      GATEWAY_CIRCUIT_FAILURE_THRESHOLD: '1',
      GATEWAY_REQUEST_TIMEOUT_MS: '100',
    });

    const firstResponse = await app.inject({
      method: 'GET',
      url: '/api/users/profile',
      headers: {
        authorization: `Bearer ${customerToken()}`,
      },
    });
    const secondResponse = await app.inject({
      method: 'GET',
      url: '/api/users/profile',
      headers: {
        authorization: `Bearer ${customerToken()}`,
      },
    });

    expect(firstResponse.statusCode).toBe(503);
    expect(secondResponse.statusCode).toBe(503);
    expect(secondResponse.json().error.code).toBe('GATEWAY_CIRCUIT_OPEN');

    await app.close();
  });
});

async function createGateway(env: NodeJS.ProcessEnv) {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    PORT: '3000',
    JWT_SECRET: jwtSecret,
    ENABLE_EXTERNAL_CONNECTIONS: 'false',
    GATEWAY_RATE_LIMIT_IP_MAX: '1000',
    GATEWAY_RATE_LIMIT_USER_MAX: '1000',
    GATEWAY_RATE_LIMIT_ENDPOINT_MAX: '1000',
    GATEWAY_RATE_LIMIT_WINDOW_SECONDS: '60',
    GATEWAY_GET_RETRY_ATTEMPTS: '0',
    ...env,
  };
  const { app } = await buildApp();
  await app.ready();

  return { app };
}

async function listen(app: FastifyInstance) {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Failed to listen on an ephemeral port');
  }

  return `http://127.0.0.1:${address.port}`;
}

function customerToken() {
  return signAccessToken(
    {
      sub: 'customer-user',
      role: 'CUSTOMER',
    },
    jwtSecret,
  );
}
