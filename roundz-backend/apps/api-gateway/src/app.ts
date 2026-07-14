import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { requestContextPlugin } from '@roundz/common';
import { loadConfig } from '@roundz/config';
import { createFastifyLoggerOptions } from '@roundz/logger';
import { dependenciesPlugin } from './plugins/dependencies.plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { RouteRegistry } from './gateway/config/route-registry';
import { ErrorHandler } from './gateway/middleware/error-handler';
import { GatewayMiddleware } from './gateway/middleware/gateway.middleware';
import { ProxyRegistry } from './gateway/proxy/proxy-registry';
import { ProxyService } from './gateway/proxy/proxy.service';
import { gatewayHealthRoutes } from './gateway/routes/health.routes';
import { metricsRoutes } from './gateway/routes/metrics.routes';
import { proxyRoutes } from './gateway/routes/proxy.routes';
import { GatewayMetrics } from './gateway/utils/metrics';

export async function buildApp() {
  const config = loadConfig({ serviceName: 'api-gateway', defaultPort: 3000 });
  const app = Fastify({
    logger: createFastifyLoggerOptions(config.serviceName, config.logLevel),
    trustProxy: true,
    bodyLimit: config.gatewayBodyLimitBytes,
    genReqId: (request) => (request.headers['x-request-id'] as string | undefined) ?? randomUUID(),
  });
  const routeRegistry = new RouteRegistry(config);
  const metrics = new GatewayMetrics();
  const proxyRegistry = new ProxyRegistry(routeRegistry.list(), config, metrics);
  const proxyService = new ProxyService(routeRegistry, proxyRegistry, config, metrics);

  await app.register(requestContextPlugin);
  ErrorHandler.register(app);
  await app.register(dependenciesPlugin, {
    enabled: config.enableExternalConnections,
    mongoUrl: config.mongoUrl,
    redisUrl: config.redisUrl,
  });
  app.addContentTypeParser(
    /^multipart\/form-data/i,
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Roundz API Gateway',
        description: 'Public API entry point for Roundz microservices.',
        version: '0.1.0',
      },
      paths: {
        '/api/auth/*': {
          post: {
            summary: 'Forward auth requests to Auth Service',
          },
        },
        '/api/users/*': {
          get: {
            summary: 'Forward user requests to User Service',
          },
        },
        '/health': {
          get: {
            summary: 'Gateway health check',
          },
        },
        '/health/ready': {
          get: {
            summary: 'Gateway readiness check',
          },
        },
        '/health/services': {
          get: {
            summary: 'Downstream service health checks',
          },
        },
        '/metrics': {
          get: {
            summary: 'Prometheus metrics',
          },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await GatewayMiddleware.register(app, { config, routeRegistry });
  await app.register(gatewayHealthRoutes, { config, routeRegistry, proxyRegistry });
  await app.register(metricsRoutes, { metrics });
  await app.register(proxyRoutes, { proxyService });

  app.addHook('onClose', async () => {
    await proxyRegistry.close();
  });

  return { app, config };
}
