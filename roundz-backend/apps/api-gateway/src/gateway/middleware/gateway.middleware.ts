import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import type { RoundzConfig } from '@roundz/config';
import type { RouteRegistry } from '../config/route-registry';
import { AuthenticationMiddleware } from './authentication.middleware';
import { CorrelationMiddleware } from './correlation.middleware';
import { RateLimitMiddleware } from './rate-limit.middleware';
import { RequestLogger } from './request-logger';

export type GatewayMiddlewareOptions = {
  config: RoundzConfig;
  routeRegistry: RouteRegistry;
};

export class GatewayMiddleware {
  static async register(app: FastifyInstance, options: GatewayMiddlewareOptions) {
    await app.register(helmet);
    await app.register(cors, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'authorization',
        'content-type',
        'x-request-id',
        'x-trace-id',
        'x-user-id',
        'x-user-role',
      ],
    });
    await app.register(compress, {
      global: true,
      encodings: ['gzip', 'br'],
    });
    await CorrelationMiddleware.register(app);
    await RequestLogger.register(app);
    await AuthenticationMiddleware.register(app, {
      jwtSecret: options.config.jwtSecret,
      routeRegistry: options.routeRegistry,
    });
    await RateLimitMiddleware.register(app, {
      config: options.config,
      redis: app.hasDecorator('redis') ? app.redis : undefined,
    });
  }
}
