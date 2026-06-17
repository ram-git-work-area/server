import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { authenticateJwt, roleGuard } from '@roundz/auth';
import { createObjectStorageProvider, type ObjectStorageProvider } from '@roundz/cloud';
import { loadConfig } from '@roundz/config';
import { createPostgresClient } from '@roundz/database';
import { UserController } from '../controllers/user.controller';
import { UserRepository, type UserRepositoryPort } from '../repositories/user.repository';
import { UserService } from '../services/user.service';
import {
  KafkaUserEventPublisher,
  NoopUserEventPublisher,
  type UserEventPublisher,
} from '../services/user-events.publisher';

export type UserRoutesOptions = {
  repository?: UserRepositoryPort;
  storageProvider?: ObjectStorageProvider;
  eventPublisher?: UserEventPublisher;
};

export async function userRoutes(app: FastifyInstance, options: UserRoutesOptions = {}) {
  const config = loadConfig({ serviceName: 'user-service', defaultPort: 3002 });
  const repository =
    options.repository ??
    new UserRepository(app.hasDecorator('postgres') ? app.postgres : createPostgresClient());
  const storageProvider =
    options.storageProvider ??
    createObjectStorageProvider(config.storageProvider, config.cloudProvider);
  const eventPublisher = options.eventPublisher ?? (await createEventPublisher(app, config));
  const controller = new UserController(
    new UserService({
      repository,
      storageProvider,
      eventPublisher,
      profileImageBucket: config.userProfileImageBucket,
    }),
  );

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
    },
  });
  app.decorateRequest('authUser', null);
  app.addHook('preHandler', authenticateJwt(config.jwtSecret));
  app.addHook('preHandler', roleGuard(['CUSTOMER']));

  app.get('/users/profile', (request, reply) => controller.getProfile(request, reply));
  app.put('/users/profile', (request, reply) => controller.updateProfile(request, reply));
  app.post('/users/profile/image', (request, reply) =>
    controller.uploadProfileImage(request, reply),
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
  app.delete('/users/favorites/:id', (request, reply) => controller.deleteFavorite(request, reply));
  app.patch('/users/language', (request, reply) =>
    controller.updatePreferredLanguage(request, reply),
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
