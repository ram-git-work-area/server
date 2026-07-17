import type Redis from 'ioredis';
import type { RiderEligibilitySnapshot } from '../../domain/matching/matching-types';

/**
 * Hot cache of rider eligibility snapshots. Kept fresh by the
 * `rider.status.changed` / `location.updated` consumers so the matching engine
 * can gate most riders without a Rider Service round-trip.
 */
export interface RiderAvailabilityCache {
  get(riderId: string): Promise<RiderEligibilitySnapshot | null>;
  set(riderId: string, snapshot: RiderEligibilitySnapshot, ttlSeconds: number): Promise<void>;
  delete(riderId: string): Promise<void>;
}

export class NoopRiderAvailabilityCache implements RiderAvailabilityCache {
  async get(): Promise<RiderEligibilitySnapshot | null> {
    return null;
  }
  async set(): Promise<void> {}
  async delete(): Promise<void> {}
}

export class MemoryRiderAvailabilityCache implements RiderAvailabilityCache {
  private readonly values = new Map<
    string,
    { value: RiderEligibilitySnapshot; expiresAt: number }
  >();

  async get(riderId: string): Promise<RiderEligibilitySnapshot | null> {
    const cached = this.values.get(key(riderId));
    if (!cached || cached.expiresAt <= Date.now()) {
      this.values.delete(key(riderId));
      return null;
    }
    return cached.value;
  }

  async set(
    riderId: string,
    snapshot: RiderEligibilitySnapshot,
    ttlSeconds: number,
  ): Promise<void> {
    this.values.set(key(riderId), { value: snapshot, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(riderId: string): Promise<void> {
    this.values.delete(key(riderId));
  }
}

export class RedisRiderAvailabilityCache implements RiderAvailabilityCache {
  constructor(private readonly redis: Redis) {}

  async get(riderId: string): Promise<RiderEligibilitySnapshot | null> {
    const value = await this.redis.get(key(riderId));
    return value ? (JSON.parse(value) as RiderEligibilitySnapshot) : null;
  }

  async set(
    riderId: string,
    snapshot: RiderEligibilitySnapshot,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(key(riderId), JSON.stringify(snapshot), 'EX', ttlSeconds);
  }

  async delete(riderId: string): Promise<void> {
    await this.redis.del(key(riderId));
  }
}

function key(riderId: string): string {
  return `trip-service:matching:availability:${riderId}`;
}
