import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { extractBearerToken, roleGuard, verifyAccessToken, type AuthRole } from '@roundz/auth';
import { loadConfig } from '@roundz/config';
import { LocationController } from '../controllers/location.controller';
import { createLocationModels } from '../models/location.models';
import {
  MongoLocationRepository,
  type LocationRepositoryPort,
} from '../repositories/location.repository';
import { BatchingHistoryWriter, type HistoryWriter } from '../services/history-writer';
import {
  KafkaLocationEventPublisher,
  NoopLocationEventPublisher,
  type LocationEventPublisher,
} from '../services/location-events.publisher';
import {
  NoopLocationCache,
  RedisLocationCache,
  type LocationCache,
} from '../services/location-cache.service';
import { LocationService } from '../services/location.service';
import { PresenceSweeper } from '../services/presence-sweeper';

export type LocationRoutesOptions = {
  repository?: LocationRepositoryPort;
  cache?: LocationCache;
  eventPublisher?: LocationEventPublisher;
  historyWriter?: HistoryWriter;
};

export async function locationRoutes(app: FastifyInstance, options: LocationRoutesOptions = {}) {
  const config = loadConfig({ serviceName: 'location-service', defaultPort: 3007 });

  const repository = options.repository ?? createRepository(app, config);
  const cache =
    options.cache ??
    (app.hasDecorator('redis') ? new RedisLocationCache(app.redis) : new NoopLocationCache());
  const eventPublisher = options.eventPublisher ?? (await createEventPublisher(app, config));
  const historyWriter =
    options.historyWriter ??
    new BatchingHistoryWriter(repository, {
      batchSize: config.locationHistoryBatchSize,
      flushIntervalMs: config.locationHistoryFlushIntervalMs,
      onError: (error, droppedCount) =>
        app.log.error({ err: error, droppedCount }, 'failed to flush location history batch'),
    });

  const service = new LocationService({
    repository,
    cache,
    eventPublisher,
    historyWriter,
    config: {
      maxSpeedMps: config.locationMaxSpeedMps,
      duplicateEpsilonMeters: config.locationDuplicateEpsilonMeters,
      presenceTimeoutSeconds: config.locationPresenceTimeoutSeconds,
      currentCacheTtlSeconds: config.locationCurrentCacheTtlSeconds,
      nearbyMaxRadiusMeters: config.locationNearbyMaxRadiusMeters,
      nearbyDefaultLimit: config.locationNearbyDefaultLimit,
      sweepBatchSize: config.locationHistoryBatchSize,
    },
  });
  const controller = new LocationController(service);

  if (config.enableExternalConnections && !options.historyWriter) {
    historyWriter.start();
    const sweeper = new PresenceSweeper(
      service,
      config.locationPresenceSweepIntervalSeconds,
      app.log,
    );
    sweeper.start();
    app.addHook('onClose', async () => {
      sweeper.stop();
      await historyWriter.stop();
    });
  }

  const jwtSecret = config.jwtSecret;
  app.decorateRequest('authUser', null);
  app.addHook('preHandler', async (request) => {
    request.authUser = verifyAccessToken(extractBearerToken(request), jwtSecret);
  });

  const guard = (roles: readonly AuthRole[]) => ({ preHandler: roleGuard(roles) });

  app.post('/location/update', guard(['RIDER']), (request, reply) =>
    controller.updateLocation(request, reply),
  );
  app.post('/location/heartbeat', guard(['RIDER']), (request, reply) =>
    controller.heartbeat(request, reply),
  );
  app.get('/location/current', guard(['RIDER']), (request, reply) =>
    controller.getCurrent(request, reply),
  );
  app.get('/location/nearby', guard(['CUSTOMER', 'RIDER', 'ADMIN', 'SUPPORT']), (request, reply) =>
    controller.getNearby(request, reply),
  );
  app.get('/location/history', guard(['RIDER', 'ADMIN', 'SUPPORT']), (request, reply) =>
    controller.getHistory(request, reply),
  );
  app.get('/location/rider/:riderId', guard(['ADMIN', 'SUPPORT']), (request, reply) =>
    controller.getRiderCurrent(request, reply),
  );
}

function createRepository(app: FastifyInstance, config: ReturnType<typeof loadConfig>) {
  const connection = app.hasDecorator('mongo') ? app.mongo : mongoose.connection;
  const models = createLocationModels(connection, {
    historyRetentionDays: config.locationHistoryRetentionDays,
    currentRetentionDays: config.locationCurrentRetentionDays,
  });

  return new MongoLocationRepository(models);
}

async function createEventPublisher(
  app: FastifyInstance,
  config: ReturnType<typeof loadConfig>,
): Promise<LocationEventPublisher> {
  if (!config.enableExternalConnections) {
    return new NoopLocationEventPublisher();
  }

  const publisher = new KafkaLocationEventPublisher(config.kafkaBrokers);
  await publisher.connect();
  app.addHook('onClose', async () => {
    await publisher.close();
  });

  return publisher;
}
