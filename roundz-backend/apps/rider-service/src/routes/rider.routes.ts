import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { assertRole, extractBearerToken, verifyAccessToken } from '@roundz/auth';
import { createObjectStorageProvider, type ObjectStorageProvider } from '@roundz/cloud';
import { loadConfig } from '@roundz/config';
import { createPostgresClient } from '@roundz/database';
import { RiderController } from '../controllers/rider.controller';
import {
  KafkaRiderEventPublisher,
  NoopRiderEventPublisher,
  type RiderEventPublisher,
} from '../events/rider-events.publisher';
import { RiderRepository, type RiderRepositoryPort } from '../repositories/rider.repository';
import { RiderService } from '../services/rider.service';
import { NoopRiderCache, RedisRiderCache, type RiderCache } from '../services/rider-cache.service';

export type RiderRoutesOptions = {
  repository?: RiderRepositoryPort;
  cache?: RiderCache;
  eventPublisher?: RiderEventPublisher;
  storageProvider?: ObjectStorageProvider;
};

export async function riderRoutes(app: FastifyInstance, options: RiderRoutesOptions = {}) {
  const config = loadConfig({ serviceName: 'rider-service', defaultPort: 3003 });
  const repository =
    options.repository ??
    new RiderRepository(app.hasDecorator('postgres') ? app.postgres : createPostgresClient());
  const cache =
    options.cache ??
    (app.hasDecorator('redis') ? new RedisRiderCache(app.redis) : new NoopRiderCache());
  const eventPublisher = options.eventPublisher ?? (await createEventPublisher(app, config));
  const storageProvider =
    options.storageProvider ??
    createObjectStorageProvider(config.storageProvider, config.cloudProvider);
  const service = new RiderService({
    repository,
    cache,
    eventPublisher,
    storageProvider,
    documentBucket: config.riderDocumentBucket,
    cacheTtlSeconds: config.riderCacheTtlSeconds,
  });
  const controller = new RiderController(service);

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 10 * 1024 * 1024,
    },
  });
  app.decorateRequest('authUser', null);
  app.addHook('preHandler', async (request) => {
    request.authUser = verifyAccessToken(extractBearerToken(request), config.jwtSecret);
    assertRole(request.authUser, ['RIDER']);
  });

  app.get('/riders/profile', (request, reply) => controller.getProfile(request, reply));
  app.put('/riders/profile', (request, reply) => controller.updateProfile(request, reply));

  app.get('/riders/vehicles', (request, reply) => controller.listVehicles(request, reply));
  app.post('/riders/vehicles', (request, reply) => controller.createVehicle(request, reply));
  app.put('/riders/vehicles/:id', (request, reply) => controller.updateVehicle(request, reply));
  app.delete('/riders/vehicles/:id', (request, reply) => controller.deleteVehicle(request, reply));
  app.patch('/riders/vehicles/:id/primary', (request, reply) =>
    controller.setPrimaryVehicle(request, reply),
  );

  app.get('/riders/documents', (request, reply) => controller.listDocuments(request, reply));
  app.post('/riders/documents', (request, reply) => controller.uploadDocument(request, reply));
  app.delete('/riders/documents/:id', (request, reply) =>
    controller.deleteDocument(request, reply),
  );

  app.get('/riders/status', (request, reply) => controller.getStatus(request, reply));
  app.patch('/riders/status', (request, reply) => controller.updateStatus(request, reply));

  app.get('/riders/preferences', (request, reply) => controller.getPreferences(request, reply));
  app.patch('/riders/preferences', (request, reply) =>
    controller.updatePreferences(request, reply),
  );
}

async function createEventPublisher(
  app: FastifyInstance,
  config: ReturnType<typeof loadConfig>,
): Promise<RiderEventPublisher> {
  if (!config.enableExternalConnections) {
    return new NoopRiderEventPublisher();
  }

  const publisher = new KafkaRiderEventPublisher(config.kafkaBrokers);
  await publisher.connect();
  app.addHook('onClose', async () => {
    await publisher.close();
  });

  return publisher;
}
