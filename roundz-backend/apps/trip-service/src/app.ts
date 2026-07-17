import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { requestContextPlugin } from '@roundz/common';
import { loadConfig } from '@roundz/config';
import { KafkaConsumerClient } from '@roundz/kafka';
import { createFastifyLoggerOptions } from '@roundz/logger';
import { dependenciesPlugin } from './plugins/dependencies.plugin';
import { errorHandlerPlugin } from './plugins/error-handler.plugin';
import { healthRoutes } from './routes/health.routes';
import { tripRoutes } from './routes/trip.routes';
import { matchingRoutes } from './routes/matching.routes';
import { buildMatchingComponents } from './services/matching/matching.factory';
import { MatchingConsumer, startMatchingConsumers } from './events/matching.consumers';

export async function buildApp() {
  const config = loadConfig({ serviceName: 'trip-service', defaultPort: 3004 });
  const app = Fastify({
    logger: createFastifyLoggerOptions(config.serviceName, config.logLevel),
    trustProxy: true,
    genReqId: (request) => (request.headers['x-request-id'] as string | undefined) ?? randomUUID(),
  });

  await app.register(requestContextPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(dependenciesPlugin, {
    enabled: config.enableExternalConnections,
    redisUrl: config.redisUrl,
  });

  const matching = await buildMatchingComponents({
    config,
    postgres: app.hasDecorator('postgres') ? app.postgres : undefined,
    redis: app.hasDecorator('redis') ? app.redis : undefined,
    logger: app.log,
  });

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(tripRoutes);
  await app.register(matchingRoutes, { service: matching.service });

  if (config.enableExternalConnections) {
    const consumer = new KafkaConsumerClient({
      clientId: 'trip-service-matching',
      groupId: 'trip-service-matching',
      brokers: config.kafkaBrokers,
    });
    await startMatchingConsumers(consumer, new MatchingConsumer(matching.engine, app.log), app.log);
    app.addHook('onClose', async () => {
      await consumer.disconnect();
    });
  }

  app.addHook('onClose', async () => {
    matching.scheduler.cancelAll();
    await matching.eventPublisher.close?.();
  });

  return { app, config };
}
