import type { FastifyInstance } from 'fastify';
import type { RoundzConfig } from '@roundz/config';
import type { ProxyRegistry } from '../proxy/proxy-registry';
import type { RouteRegistry } from '../config/route-registry';

export async function gatewayHealthRoutes(
  app: FastifyInstance,
  options: {
    config: RoundzConfig;
    routeRegistry: RouteRegistry;
    proxyRegistry: ProxyRegistry;
  },
) {
  app.get('/health', async () => ({
    service: 'api-gateway',
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get('/health/ready', async () => ({
    service: 'api-gateway',
    status: 'ok',
    timestamp: new Date().toISOString(),
    configuredServices: options.routeRegistry.list().filter((route) => route.baseUrl).length,
  }));

  app.get('/health/services', async () => {
    const results = await Promise.all(
      options.routeRegistry.list().map(async (route) => {
        if (!route.baseUrl) {
          return {
            service: route.serviceName,
            status: 'not_configured',
            circuit: options.proxyRegistry.get(route)?.circuitBreaker.snapshot(),
          };
        }

        const startedAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.config.gatewayHealthTimeoutMs);

        try {
          const response = await fetch(`${route.baseUrl}/health/ready`, {
            method: 'GET',
            signal: controller.signal,
          });

          return {
            service: route.serviceName,
            status: response.ok ? 'up' : 'down',
            statusCode: response.status,
            latencyMs: Date.now() - startedAt,
            circuit: options.proxyRegistry.get(route)?.circuitBreaker.snapshot(),
          };
        } catch (error) {
          return {
            service: route.serviceName,
            status: 'down',
            latencyMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : 'unknown error',
            circuit: options.proxyRegistry.get(route)?.circuitBreaker.snapshot(),
          };
        } finally {
          clearTimeout(timeout);
        }
      }),
    );

    return {
      service: 'api-gateway',
      status: results.every(
        (result) => result.status === 'up' || result.status === 'not_configured',
      )
        ? 'ok'
        : 'degraded',
      timestamp: new Date().toISOString(),
      services: results,
    };
  });
}
