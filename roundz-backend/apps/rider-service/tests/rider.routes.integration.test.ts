import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '@roundz/auth';
import { registerErrorHandler } from '@roundz/errors';
import { riderRoutes } from '../src/routes/rider.routes';
import {
  MemoryObjectStorageProvider,
  MemoryRiderCache,
  MemoryRiderEventPublisher,
  MemoryRiderRepository,
} from './memory-rider.repository';

const jwtSecret = 'rider-service-integration-secret';
const riderUserId = 'rider-integration-user';
const previousJwtSecret = process.env.JWT_SECRET;

describe('Rider Service routes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = jwtSecret;
    process.env.PORT = '3003';
  });

  afterEach(() => {
    process.env.JWT_SECRET = previousJwtSecret;
  });

  it('requires a RIDER JWT for rider routes', async () => {
    const { app } = await createApp();
    const noToken = await app.inject({ method: 'GET', url: '/riders/profile' });
    const customerToken = signAccessToken({ sub: 'customer-user', role: 'CUSTOMER' }, jwtSecret);
    const customer = await app.inject({
      method: 'GET',
      url: '/riders/profile',
      headers: { authorization: `Bearer ${customerToken}` },
    });

    expect(noToken.statusCode).toBe(401);
    expect(customer.statusCode).toBe(403);
    await app.close();
  });

  it('returns 404 before onboarding and onboards on profile update', async () => {
    const { app } = await createApp();
    const token = riderToken();
    const before = await app.inject({
      method: 'GET',
      url: '/riders/profile',
      headers: { authorization: `Bearer ${token}` },
    });
    const onboard = await app.inject({
      method: 'PUT',
      url: '/riders/profile',
      headers: { authorization: `Bearer ${token}`, 'x-trace-id': 'trace-1' },
      payload: { profilePhoto: 's3://bucket/photo.png' },
    });
    const after = await app.inject({
      method: 'GET',
      url: '/riders/profile',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(before.statusCode).toBe(404);
    expect(onboard.statusCode).toBe(200);
    expect(onboard.json().data.riderCode).toMatch(/^RDR-/);
    expect(after.json().data.profilePhoto).toBe('s3://bucket/photo.png');
    await app.close();
  });

  it('creates and lists vehicles with cursor metadata', async () => {
    const { app } = await createApp();
    const token = riderToken();
    await onboard(app, token);
    const create = await app.inject({
      method: 'POST',
      url: '/riders/vehicles',
      headers: { authorization: `Bearer ${token}` },
      payload: vehiclePayload('KA05MN2244'),
    });
    const list = await app.inject({
      method: 'GET',
      url: '/riders/vehicles?limit=10',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(create.statusCode).toBe(201);
    expect(create.json().data.isPrimary).toBe(true);
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
    expect(list.json().meta.pagination.hasMore).toBe(false);
    await app.close();
  });

  it('uploads a document through multipart form data', async () => {
    const { app } = await createApp();
    const token = riderToken();
    await onboard(app, token);
    const { body, contentType } = multipartDocument('DRIVING_LICENSE', 'license.png');
    const upload = await app.inject({
      method: 'POST',
      url: '/riders/documents',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      payload: body,
    });
    const list = await app.inject({
      method: 'GET',
      url: '/riders/documents',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(upload.statusCode).toBe(201);
    expect(upload.json().data.documentType).toBe('DRIVING_LICENSE');
    expect(upload.json().data.verificationStatus).toBe('PENDING');
    expect(list.json().data).toHaveLength(1);
    await app.close();
  });

  it('blocks going online for an unapproved rider', async () => {
    const { app } = await createApp();
    const token = riderToken();
    await onboard(app, token);
    const online = await app.inject({
      method: 'PATCH',
      url: '/riders/status',
      headers: { authorization: `Bearer ${token}` },
      payload: { onlineStatus: 'ONLINE' },
    });
    const offline = await app.inject({
      method: 'PATCH',
      url: '/riders/status',
      headers: { authorization: `Bearer ${token}` },
      payload: { onlineStatus: 'OFFLINE' },
    });

    expect(online.statusCode).toBe(409);
    expect(offline.statusCode).toBe(200);
    expect(offline.json().data.onlineStatus).toBe('OFFLINE');
    await app.close();
  });

  it('reads and updates rider preferences', async () => {
    const { app } = await createApp();
    const token = riderToken();
    await onboard(app, token);
    const get = await app.inject({
      method: 'GET',
      url: '/riders/preferences',
      headers: { authorization: `Bearer ${token}` },
    });
    const update = await app.inject({
      method: 'PATCH',
      url: '/riders/preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { preferredLanguage: 'hi-IN', autoAcceptTrips: true },
    });

    expect(get.statusCode).toBe(200);
    expect(get.json().data.preferredLanguage).toBe('en');
    expect(update.statusCode).toBe(200);
    expect(update.json().data.autoAcceptTrips).toBe(true);
    await app.close();
  });
});

async function createApp() {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(riderRoutes, {
    repository: new MemoryRiderRepository(),
    cache: new MemoryRiderCache(),
    eventPublisher: new MemoryRiderEventPublisher(),
    storageProvider: new MemoryObjectStorageProvider(),
  });
  await app.ready();
  return { app };
}

function riderToken() {
  return signAccessToken({ sub: riderUserId, role: 'RIDER' }, jwtSecret);
}

async function onboard(app: Awaited<ReturnType<typeof createApp>>['app'], token: string) {
  await app.inject({
    method: 'PUT',
    url: '/riders/profile',
    headers: { authorization: `Bearer ${token}` },
    payload: { profilePhoto: null },
  });
}

function vehiclePayload(registrationNumber: string) {
  return {
    vehicleType: 'BIKE',
    brand: 'Honda',
    model: 'Activa',
    color: 'Black',
    registrationNumber,
    registrationState: 'KA',
    manufacturingYear: 2022,
    isPrimary: true,
  };
}

function multipartDocument(documentType: string, fileName: string) {
  const boundary = '----RoundzRiderTestBoundary';
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="documentType"\r\n\r\n` +
    `${documentType}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: image/png\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([
    Buffer.from(head, 'utf8'),
    Buffer.from('binary-image-content'),
    Buffer.from(tail, 'utf8'),
  ]);

  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
