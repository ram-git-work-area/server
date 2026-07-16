import { AppError } from '@roundz/errors';

type RedisLike = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number | boolean>;
};

export interface AuthRateLimiter {
  assertAllowed(input: { key: string; limit: number; windowSeconds: number }): Promise<void>;
}

export class NoopAuthRateLimiter implements AuthRateLimiter {
  async assertAllowed(): Promise<void> {
    return undefined;
  }
}

export class RedisAuthRateLimiter implements AuthRateLimiter {
  constructor(private readonly redis: RedisLike) {}

  async assertAllowed(input: { key: string; limit: number; windowSeconds: number }) {
    const attempts = await this.redis.incr(input.key);

    if (attempts === 1) {
      await this.redis.expire(input.key, input.windowSeconds);
    }

    if (attempts > input.limit) {
      throw new AppError('Too many requests', 429, 'AUTH_RATE_LIMITED');
    }
  }
}
