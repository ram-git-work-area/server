import type { PrismaClient } from '@prisma/client';
import type { RoundzConfig } from '@roundz/config';
import { createPostgresClient } from '@roundz/database';
import { InMemoryDistributedLock, RedisDistributedLock } from '@roundz/redis';
import type Redis from 'ioredis';
import { resolveStrategy } from '../../domain/matching/strategies';
import { HttpLocationClient, InMemoryLocationClient } from '../../clients/location.client';
import { HttpRiderClient, InMemoryRiderClient } from '../../clients/rider.client';
import {
  KafkaMatchingEventPublisher,
  NoopMatchingEventPublisher,
  type MatchingEventPublisher,
} from '../../events/matching-events.publisher';
import { MatchingSessionRepository } from '../../repositories/matching-session.repository';
import { TripRepository } from '../../repositories/trip.repository';
import { NoopTripCache, RedisTripCache } from '../trip-cache.service';
import { TimeoutDispatchScheduler, type DispatchScheduler } from './dispatch-scheduler';
import { MemoryDispatchStore, RedisDispatchStore } from './dispatch.store';
import { MatchingEngine, type MatchingLogger } from './matching-engine.service';
import { MatchingService } from './matching.service';
import {
  NoopRiderAvailabilityCache,
  RedisRiderAvailabilityCache,
} from './rider-availability.cache';
import { RepositoryTripGateway } from './trip-gateway';

export type MatchingComponents = {
  engine: MatchingEngine;
  service: MatchingService;
  scheduler: DispatchScheduler;
  eventPublisher: MatchingEventPublisher;
};

export type BuildMatchingOptions = {
  config: RoundzConfig;
  postgres?: PrismaClient;
  redis?: Redis;
  logger?: MatchingLogger;
};

/**
 * Wires the matching engine from live dependencies, selecting Redis/Kafka/HTTP
 * adapters when external connections are enabled and safe in-memory/no-op
 * fallbacks for local scaffold startup. Tests construct the engine directly with
 * in-memory doubles instead of using this factory.
 */
export async function buildMatchingComponents(
  options: BuildMatchingOptions,
): Promise<MatchingComponents> {
  const { config, redis, logger } = options;
  const postgres = options.postgres ?? createPostgresClient();

  const tripRepository = new TripRepository(postgres);
  const sessionRepository = new MatchingSessionRepository(postgres);
  const tripCache = redis ? new RedisTripCache(redis) : new NoopTripCache();

  const locationClient = config.serviceUrls.location
    ? new HttpLocationClient(config.serviceUrls.location, config.gatewayRequestTimeoutMs)
    : new InMemoryLocationClient();
  const riderClient = config.serviceUrls.riders
    ? new HttpRiderClient(config.serviceUrls.riders, config.gatewayRequestTimeoutMs)
    : new InMemoryRiderClient();

  const availabilityCache = redis
    ? new RedisRiderAvailabilityCache(redis)
    : new NoopRiderAvailabilityCache();
  const dispatchStore = redis ? new RedisDispatchStore(redis) : new MemoryDispatchStore();
  const lock = redis ? new RedisDistributedLock(redis) : new InMemoryDistributedLock();

  const eventPublisher: MatchingEventPublisher = config.enableExternalConnections
    ? new KafkaMatchingEventPublisher(config.kafkaBrokers)
    : new NoopMatchingEventPublisher();
  if (eventPublisher instanceof KafkaMatchingEventPublisher) {
    await eventPublisher.connect();
  }

  const scheduler = new TimeoutDispatchScheduler((error, tripId) =>
    logger?.error({ err: error, tripId }, 'dispatch timeout task failed'),
  );

  const tripGateway = new RepositoryTripGateway(
    tripRepository,
    tripCache,
    eventPublisher,
    config.tripCacheTtlSeconds,
  );

  const engine = new MatchingEngine({
    tripGateway,
    sessionRepository,
    locationClient,
    riderClient,
    availabilityCache,
    dispatchStore,
    lock,
    scheduler,
    eventPublisher,
    strategy: resolveStrategy(config.matching.strategy),
    config: config.matching,
    logger,
  });

  return { engine, service: new MatchingService(engine), scheduler, eventPublisher };
}
