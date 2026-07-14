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
    await app.register(CorrelationMiddleware.plugin());
    await app.register(RequestLogger.plugin());
    await app.register(
      AuthenticationMiddleware.plugin({
        jwtSecret: options.config.jwtSecret,
        routeRegistry: options.routeRegistry,
      }),
    );
    await app.register(
      RateLimitMiddleware.plugin({
        config: options.config,
        redis: app.hasDecorator('redis') ? app.redis : undefined,
      }),
    );
  }
}
