import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { assertRole, extractBearerToken, verifyAccessToken } from '@roundz/auth';
import { createObjectStorageProvider, type ObjectStorageProvider } from '@roundz/cloud';
import { loadConfig } from '@roundz/config';
import { createPostgresClient } from '@roundz/database';
import { UserController } from '../controllers/user.controller';
import {
  KafkaUserEventPublisher,
  NoopUserEventPublisher,
  type UserEventPublisher,
} from '../events/user-events.publisher';
import { UserRepository, type UserRepositoryPort } from '../repositories/user.repository';
import { UserService } from '../services/user.service';
import { NoopUserCache, RedisUserCache, type UserCache } from '../services/user-cache.service';

export type UserRoutesOptions = {
  repository?: UserRepositoryPort;
  cache?: UserCache;
  eventPublisher?: UserEventPublisher;
  storageProvider?: ObjectStorageProvider;
};

export async function userRoutes(app: FastifyInstance, options: UserRoutesOptions = {}) {
  const config = loadConfig({ serviceName: 'user-service', defaultPort: 3002 });
  const repository =
    options.repository ??
    new UserRepository(app.hasDecorator('postgres') ? app.postgres : createPostgresClient());
  const cache =
    options.cache ??
    (app.hasDecorator('redis') ? new RedisUserCache(app.redis) : new NoopUserCache());
  const eventPublisher = options.eventPublisher ?? (await createEventPublisher(app, config));
  const storageProvider =
    options.storageProvider ??
    createObjectStorageProvider(config.storageProvider, config.cloudProvider);
  const service = new UserService({
    repository,
    cache,
    eventPublisher,
    storageProvider,
    profileImageBucket: config.userProfileImageBucket,
    cacheTtlSeconds: config.userCacheTtlSeconds,
  });
  const controller = new UserController(service);

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 5 * 1024 * 1024,
    },
  });
  app.decorateRequest('authUser', null);
  app.addHook('preHandler', async (request) => {
    request.authUser = verifyAccessToken(extractBearerToken(request), config.jwtSecret);
    assertRole(request.authUser, ['CUSTOMER']);
  });

  app.get('/users/profile', (request, reply) => controller.getProfile(request, reply));
  app.put('/users/profile', (request, reply) => controller.updateProfile(request, reply));
  app.post('/users/profile/image', (request, reply) =>
    controller.uploadProfileImage(request, reply),
  );
  app.delete('/users/profile/image', (request, reply) =>
    controller.deleteProfileImage(request, reply),
  );
  app.get('/users/addresses', (request, reply) => controller.listAddresses(request, reply));
  app.post('/users/addresses', (request, reply) => controller.createAddress(request, reply));
  app.put('/users/addresses/:id', (request, reply) => controller.updateAddress(request, reply));
  app.delete('/users/addresses/:id', (request, reply) => controller.deleteAddress(request, reply));
  app.patch('/users/addresses/:id/default', (request, reply) =>
    controller.setDefaultAddress(request, reply),
  );
  app.get('/users/favorites', (request, reply) => controller.listFavorites(request, reply));
  app.post('/users/favorites', (request, reply) => controller.createFavorite(request, reply));
  app.put('/users/favorites/:id', (request, reply) => controller.updateFavorite(request, reply));
  app.delete('/users/favorites/:id', (request, reply) => controller.deleteFavorite(request, reply));
  app.get('/users/settings', (request, reply) => controller.getSettings(request, reply));
  app.patch('/users/settings', (request, reply) => controller.updateSettings(request, reply));
  app.patch('/users/emergency-contact', (request, reply) =>
    controller.updateEmergencyContact(request, reply),
  );
}

async function createEventPublisher(
  app: FastifyInstance,
  config: ReturnType<typeof loadConfig>,
): Promise<UserEventPublisher> {
  if (!config.enableExternalConnections) {
    return new NoopUserEventPublisher();
  }

  const publisher = new KafkaUserEventPublisher(config.kafkaBrokers);
  await publisher.connect();
  app.addHook('onClose', async () => {
    await publisher.close();
  });

  return publisher;
}
