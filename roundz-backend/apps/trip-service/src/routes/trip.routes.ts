import type { FastifyInstance, FastifyRequest } from 'fastify';
import { extractBearerToken, roleGuard, verifyAccessToken, type AuthRole } from '@roundz/auth';
import { loadConfig } from '@roundz/config';
import { createPostgresClient } from '@roundz/database';
import { AppError } from '@roundz/errors';
import { TripController } from '../controllers/trip.controller';
import {
  KafkaTripEventPublisher,
  NoopTripEventPublisher,
  type TripEventPublisher,
} from '../events/trip-events.publisher';
import { TripRepository, type TripRepositoryPort } from '../repositories/trip.repository';
import { TripService } from '../services/trip.service';
import { NoopTripCache, RedisTripCache, type TripCache } from '../services/trip-cache.service';

export type TripRoutesOptions = {
  repository?: TripRepositoryPort;
  cache?: TripCache;
  eventPublisher?: TripEventPublisher;
};

export async function tripRoutes(app: FastifyInstance, options: TripRoutesOptions = {}) {
  const config = loadConfig({ serviceName: 'trip-service', defaultPort: 3004 });
  const repository =
    options.repository ??
    new TripRepository(app.hasDecorator('postgres') ? app.postgres : createPostgresClient());
  const cache =
    options.cache ??
    (app.hasDecorator('redis') ? new RedisTripCache(app.redis) : new NoopTripCache());
  const eventPublisher = options.eventPublisher ?? (await createEventPublisher(app, config));
  const service = new TripService({
    repository,
    cache,
    eventPublisher,
    cacheTtlSeconds: config.tripCacheTtlSeconds,
  });
  const controller = new TripController(service);

  const jwtSecret = config.jwtSecret;
  app.decorateRequest('authUser', null);
  app.addHook('preHandler', async (request) => {
    request.authUser = verifyAccessToken(extractBearerToken(request), jwtSecret);
  });

  const guard = (roles: readonly AuthRole[]) => ({ preHandler: roleGuard(roles) });
  const internalGuard = { preHandler: assertInternalCaller };

  app.post('/trips', guard(['CUSTOMER']), (request, reply) =>
    controller.createTrip(request, reply),
  );
  app.get('/trips', guard(['CUSTOMER']), (request, reply) => controller.listTrips(request, reply));
  app.get('/trips/:id', guard(['CUSTOMER', 'ADMIN', 'SUPPORT']), (request, reply) =>
    controller.getTrip(request, reply),
  );
  app.patch('/trips/:id/cancel', guard(['CUSTOMER']), (request, reply) =>
    controller.cancelTrip(request, reply),
  );
  app.patch('/trips/:id/status', internalGuard, (request, reply) =>
    controller.updateStatus(request, reply),
  );
}

async function assertInternalCaller(request: FastifyRequest) {
  const user = request.authUser;
  const isPrivileged = user?.role === 'ADMIN' || user?.role === 'SUPPORT';
  const isService = Boolean(user?.service);

  if (!user || (!isPrivileged && !isService)) {
    throw new AppError('Internal access required', 403, 'TRIP_INTERNAL_ONLY');
  }
}

async function createEventPublisher(
  app: FastifyInstance,
  config: ReturnType<typeof loadConfig>,
): Promise<TripEventPublisher> {
  if (!config.enableExternalConnections) {
    return new NoopTripEventPublisher();
  }

  const publisher = new KafkaTripEventPublisher(config.kafkaBrokers);
  await publisher.connect();
  app.addHook('onClose', async () => {
    await publisher.close();
  });

  return publisher;
}
