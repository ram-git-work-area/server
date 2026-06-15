import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { requestContextPlugin } from '@roundz/common';
import { loadConfig } from '@roundz/config';
import { createFastifyLoggerOptions } from '@roundz/logger';
import { dependenciesPlugin } from './plugins/dependencies.plugin';
import { errorHandlerPlugin } from './plugins/error-handler.plugin';
import { healthRoutes } from './routes/health.routes';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { gatewayRoutes } from './routes/gateway.routes';
import { authMiddlewarePlugin } from './plugins/auth-middleware.plugin';
import { rateLimitPlaceholderPlugin } from './plugins/rate-limit-placeholder.plugin';

export async function buildApp() {
  const config = loadConfig({ serviceName: 'api-gateway', defaultPort: 3000 });
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
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Roundz API Gateway',
        description: 'Public API entry point for Roundz microservices.',
        version: '0.1.0',
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await app.register(authMiddlewarePlugin);
  await app.register(rateLimitPlaceholderPlugin);
  await app.register(gatewayRoutes);

  return { app, config };
}
