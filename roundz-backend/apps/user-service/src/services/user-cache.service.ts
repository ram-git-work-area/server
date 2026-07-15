type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
};

export interface UserCache {
  getJson<T>(key: string): Promise<T | null>;
  setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(keys: string[]): Promise<void>;
}

export class NoopUserCache implements UserCache {
  async getJson<T>(): Promise<T | null> {
    return null;
  }

  async setJson(): Promise<void> {
    return undefined;
  }

  async delete(): Promise<void> {
    return undefined;
  }
}

export class MemoryUserCache implements UserCache {
  private readonly values = new Map<string, { value: string; expiresAt: number }>();

  async getJson<T>(key: string): Promise<T | null> {
    const cached = this.values.get(key);

    if (!cached || cached.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }

    return JSON.parse(cached.value) as T;
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number) {
    this.values.set(key, {
      value: JSON.stringify(value),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async delete(keys: string[]) {
    for (const key of keys) {
      this.values.delete(key);
    }
  }
}

export class RedisUserCache implements UserCache {
  constructor(private readonly redis: RedisLike) {}

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number) {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async delete(keys: string[]) {
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}

export function profileCacheKey(userId: string) {
  return `user-service:profile:${userId}`;
}

export function settingsCacheKey(userId: string) {
  return `user-service:settings:${userId}`;
}
