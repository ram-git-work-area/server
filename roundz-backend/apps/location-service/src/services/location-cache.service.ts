import type { CurrentLocation } from '../repositories/location.repository';

interface RedisLike {
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<unknown>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  set(key: string, value: string, mode: 'PX', ttlMs: number, condition: 'NX'): Promise<'OK' | null>;
}

export interface LocationCache {
  getCurrent(riderId: string): Promise<CurrentLocation | null>;
  setCurrent(riderId: string, location: CurrentLocation, ttlSeconds: number): Promise<void>;
  deleteCurrent(riderId: string): Promise<void>;
  refreshPresence(riderId: string, ttlSeconds: number): Promise<void>;
  tryAcquireLock(lockKey: string, ttlMs: number): Promise<boolean>;
}

export class NoopLocationCache implements LocationCache {
  async getCurrent(): Promise<CurrentLocation | null> {
    return null;
  }

  async setCurrent(): Promise<void> {
    return undefined;
  }

  async deleteCurrent(): Promise<void> {
    return undefined;
  }

  async refreshPresence(): Promise<void> {
    return undefined;
  }

  async tryAcquireLock(): Promise<boolean> {
    return true;
  }
}

export class MemoryLocationCache implements LocationCache {
  private readonly values = new Map<string, { value: string; expiresAt: number }>();

  async getCurrent(riderId: string): Promise<CurrentLocation | null> {
    const cached = this.read(currentKey(riderId));
    return cached ? normalizeDates(JSON.parse(cached) as CurrentLocation) : null;
  }

  async setCurrent(riderId: string, location: CurrentLocation, ttlSeconds: number) {
    this.write(currentKey(riderId), JSON.stringify(location), ttlSeconds * 1000);
  }

  async deleteCurrent(riderId: string) {
    this.values.delete(currentKey(riderId));
  }

  async refreshPresence(riderId: string, ttlSeconds: number) {
    this.write(presenceKey(riderId), '1', ttlSeconds * 1000);
  }

  async tryAcquireLock(lockKey: string, ttlMs: number): Promise<boolean> {
    if (this.read(lockKey)) {
      return false;
    }

    this.write(lockKey, '1', ttlMs);
    return true;
  }

  private read(key: string): string | null {
    const cached = this.values.get(key);

    if (!cached || cached.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }

    return cached.value;
  }

  private write(key: string, value: string, ttlMs: number) {
    this.values.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

export class RedisLocationCache implements LocationCache {
  constructor(private readonly redis: RedisLike) {}

  async getCurrent(riderId: string): Promise<CurrentLocation | null> {
    const value = await this.redis.get(currentKey(riderId));
    return value ? normalizeDates(JSON.parse(value) as CurrentLocation) : null;
  }

  async setCurrent(riderId: string, location: CurrentLocation, ttlSeconds: number) {
    await this.redis.set(currentKey(riderId), JSON.stringify(location), 'EX', ttlSeconds);
  }

  async deleteCurrent(riderId: string) {
    await this.redis.del(currentKey(riderId));
  }

  async refreshPresence(riderId: string, ttlSeconds: number) {
    await this.redis.set(presenceKey(riderId), '1', 'EX', ttlSeconds);
  }

  async tryAcquireLock(lockKey: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(lockKey, '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }
}

function normalizeDates(location: CurrentLocation): CurrentLocation {
  return { ...location, lastUpdatedAt: new Date(location.lastUpdatedAt) };
}

function currentKey(riderId: string) {
  return `location-service:current:${riderId}`;
}

function presenceKey(riderId: string) {
  return `location-service:presence:${riderId}`;
}

export const PRESENCE_SWEEP_LOCK_KEY = 'location-service:lock:presence-sweep';
