import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

export type LockHandle = {
  key: string;
  token: string;
};

/**
 * Minimal distributed lock abstraction. Implementations must guarantee that a
 * lock is only released by the caller that acquired it (fencing via a random
 * token), so a slow worker cannot release a lock another worker now owns.
 */
export interface DistributedLock {
  acquire(key: string, ttlMs: number): Promise<LockHandle | null>;
  release(handle: LockHandle): Promise<void>;
  /**
   * Runs `fn` while holding `key`. Returns `null` without running `fn` when the
   * lock cannot be acquired, so callers can treat contention as a no-op.
   */
  withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null>;
}

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Redis-backed lock using `SET key token NX PX ttl` and a compare-and-delete
 * Lua script for safe release. Suitable for coordinating multiple matching
 * workers so a single trip is processed once and a rider is assigned once.
 */
export class RedisDistributedLock implements DistributedLock {
  constructor(private readonly redis: Redis) {}

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    const token = randomUUID();
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? { key, token } : null;
  }

  async release(handle: LockHandle): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, handle.key, handle.token);
  }

  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const handle = await this.acquire(key, ttlMs);
    if (!handle) {
      return null;
    }

    try {
      return await fn();
    } finally {
      await this.release(handle);
    }
  }
}

/**
 * In-memory lock for tests and single-process local runs. Honours TTL expiry so
 * lock-timeout behaviour can be exercised deterministically.
 */
export class InMemoryDistributedLock implements DistributedLock {
  private readonly locks = new Map<string, { token: string; expiresAt: number }>();

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return null;
    }

    const token = randomUUID();
    this.locks.set(key, { token, expiresAt: Date.now() + ttlMs });
    return { key, token };
  }

  async release(handle: LockHandle): Promise<void> {
    const existing = this.locks.get(handle.key);
    if (existing && existing.token === handle.token) {
      this.locks.delete(handle.key);
    }
  }

  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const handle = await this.acquire(key, ttlMs);
    if (!handle) {
      return null;
    }

    try {
      return await fn();
    } finally {
      await this.release(handle);
    }
  }
}
