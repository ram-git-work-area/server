import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { AppError } from '@roundz/errors';
import type { RoundzConfig } from '@roundz/config';

type RedisLike = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number | boolean>;
};

type RateLimitStore = {
  increment(key: string, windowSeconds: number): Promise<number>;
};

class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisLike) {}

  async increment(key: string, windowSeconds: number) {
    const count = await this.redis.incr(key);

    if (count === 1) {
      await this.redis.expire(key, windowSeconds);
    }

    return count;
  }
}

class MemoryRateLimitStore implements RateLimitStore {
  private readonly values = new Map<string, { count: number; expiresAt: number }>();

  async increment(key: string, windowSeconds: number) {
    const now = Date.now();
    const existing = this.values.get(key);

    if (!existing || existing.expiresAt <= now) {
      this.values.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return 1;
    }

    existing.count += 1;
    return existing.count;
  }
}

export type RateLimitMiddlewareOptions = {
  config: RoundzConfig;
  redis?: RedisLike;
};

export class RateLimitMiddleware {
  static async register(app: FastifyInstance, options: RateLimitMiddlewareOptions) {
    const store = options.redis
      ? new RedisRateLimitStore(options.redis)
      : new MemoryRateLimitStore();

    if (!options.redis) {
      app.log.warn('gateway Redis rate limiting is using in-memory fallback');
    }

    app.addHook('preHandler', async (request) => {
      if (!request.url.startsWith('/api/')) {
        return;
      }

      const endpointKey = normalizeEndpoint(request.url);
      const checks = [
        {
          key: `gateway:rate:ip:${request.ip}`,
          limit: options.config.gatewayRateLimitIpMax,
        },
        {
          key: `gateway:rate:endpoint:${request.method}:${endpointKey}`,
          limit: options.config.gatewayRateLimitEndpointMax,
        },
      ];

      if (request.authUser) {
        checks.push({
          key: `gateway:rate:user:${request.authUser.sub}`,
          limit: options.config.gatewayRateLimitUserMax,
        });
      }

      for (const check of checks) {
        const count = await store.increment(
          check.key,
          options.config.gatewayRateLimitWindowSeconds,
        );

        if (count > check.limit) {
          throw new AppError('Too many requests', 429, 'GATEWAY_RATE_LIMITED');
        }
      }
    });
  }

  static plugin(options: RateLimitMiddlewareOptions): FastifyPluginAsync {
    return async (app) => {
      await RateLimitMiddleware.register(app, options);
    };
  }
}

function normalizeEndpoint(url: string) {
  return new URL(url, 'http://gateway.local').pathname;
}
