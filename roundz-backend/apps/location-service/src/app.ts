import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { requestContextPlugin } from '@roundz/common';
import { loadConfig } from '@roundz/config';
import { createFastifyLoggerOptions } from '@roundz/logger';
import { dependenciesPlugin } from './plugins/dependencies.plugin';
import { errorHandlerPlugin } from './plugins/error-handler.plugin';
import { healthRoutes } from './routes/health.routes';

export async function buildApp() {
  const config = loadConfig({ serviceName: 'location-service', defaultPort: 3007 });
  const app = Fastify({
    logger: createFastifyLoggerOptions(config.serviceName, config.logLevel),
    trustProxy: true,
    genReqId: (request) => (request.headers['x-request-id'] as string | undefined) ?? randomUUID(),
  });

  await app.register(requestContextPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(dependenciesPlugin, {
    enabled: config.enableExternalConnections,
    mongoUrl: config.mongoUrl,
    redisUrl: config.redisUrl,
  });
  await app.register(healthRoutes, { prefix: '/health' });

  return { app, config };
}
