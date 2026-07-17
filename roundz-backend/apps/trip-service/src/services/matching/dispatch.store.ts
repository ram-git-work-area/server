import type Redis from 'ioredis';

/**
 * Tracks dispatch offers in Redis so that:
 * - a rider is offered to at most one trip at a time (cross-worker reservation),
 * - a session never re-offers a rider it already contacted, and
 * - the engine knows how many offers in the current batch are still pending.
 *
 * All state is ephemeral (TTL-bounded) — the durable record of progress lives in
 * the `MatchingSession` row.
 */
export interface DispatchStore {
  /** Atomically reserve a rider for a trip. Returns false if already reserved. */
  reserveRider(tripId: string, riderId: string, ttlSeconds: number): Promise<boolean>;
  releaseRider(riderId: string): Promise<void>;
  /**
   * Durably binds a rider to a trip on assignment. Unlike a reservation (which is
   * released when a session ends or a batch times out) a binding persists so a
   * rider can never be assigned to a second trip. Returns false if the rider is
   * already bound. Released by `unbindRider` when the trip's lifecycle frees the
   * rider (later phases) or when the binding TTL elapses.
   */
  bindRider(tripId: string, riderId: string, ttlSeconds: number): Promise<boolean>;
  unbindRider(riderId: string): Promise<void>;
  markPending(tripId: string, riderId: string, ttlSeconds: number): Promise<void>;
  clearPending(tripId: string, riderId: string): Promise<void>;
  getPendingCount(tripId: string): Promise<number>;
  getPendingRiders(tripId: string): Promise<string[]>;
  getOfferedRiders(tripId: string): Promise<string[]>;
  /** Releases every reservation for the session and clears its offer sets. */
  clearSession(tripId: string): Promise<void>;
}

export class MemoryDispatchStore implements DispatchStore {
  private readonly reservations = new Map<string, { tripId: string; expiresAt: number }>();
  private readonly bindings = new Map<string, { tripId: string; expiresAt: number }>();
  private readonly offered = new Map<string, Set<string>>();
  private readonly pending = new Map<string, Set<string>>();

  async reserveRider(tripId: string, riderId: string, ttlSeconds: number): Promise<boolean> {
    const existing = this.reservations.get(riderId);
    if (existing && existing.expiresAt > Date.now()) {
      return false;
    }

    this.reservations.set(riderId, { tripId, expiresAt: Date.now() + ttlSeconds * 1000 });
    this.addTo(this.offered, tripId, riderId);
    return true;
  }

  async releaseRider(riderId: string): Promise<void> {
    this.reservations.delete(riderId);
  }

  async bindRider(tripId: string, riderId: string, ttlSeconds: number): Promise<boolean> {
    const existing = this.bindings.get(riderId);
    if (existing && existing.expiresAt > Date.now()) {
      return existing.tripId === tripId;
    }
    this.bindings.set(riderId, { tripId, expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async unbindRider(riderId: string): Promise<void> {
    this.bindings.delete(riderId);
  }

  async markPending(tripId: string, riderId: string, _ttlSeconds: number): Promise<void> {
    this.addTo(this.pending, tripId, riderId);
  }

  async clearPending(tripId: string, riderId: string): Promise<void> {
    this.pending.get(tripId)?.delete(riderId);
  }

  async getPendingCount(tripId: string): Promise<number> {
    return this.pending.get(tripId)?.size ?? 0;
  }

  async getPendingRiders(tripId: string): Promise<string[]> {
    return [...(this.pending.get(tripId) ?? [])];
  }

  async getOfferedRiders(tripId: string): Promise<string[]> {
    return [...(this.offered.get(tripId) ?? [])];
  }

  async clearSession(tripId: string): Promise<void> {
    for (const riderId of this.offered.get(tripId) ?? []) {
      const reservation = this.reservations.get(riderId);
      if (reservation?.tripId === tripId) {
        this.reservations.delete(riderId);
      }
    }
    this.offered.delete(tripId);
    this.pending.delete(tripId);
  }

  private addTo(map: Map<string, Set<string>>, tripId: string, riderId: string) {
    const set = map.get(tripId) ?? new Set<string>();
    set.add(riderId);
    map.set(tripId, set);
  }
}

export class RedisDispatchStore implements DispatchStore {
  constructor(private readonly redis: Redis) {}

  async reserveRider(tripId: string, riderId: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(reservationKey(riderId), tripId, 'EX', ttlSeconds, 'NX');
    if (result !== 'OK') {
      return false;
    }
    await this.redis.sadd(offeredKey(tripId), riderId);
    await this.redis.expire(offeredKey(tripId), ttlSeconds * 4);
    return true;
  }

  async releaseRider(riderId: string): Promise<void> {
    await this.redis.del(reservationKey(riderId));
  }

  async bindRider(tripId: string, riderId: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(bindingKey(riderId), tripId, 'EX', ttlSeconds, 'NX');
    if (result === 'OK') {
      return true;
    }
    const current = await this.redis.get(bindingKey(riderId));
    return current === tripId;
  }

  async unbindRider(riderId: string): Promise<void> {
    await this.redis.del(bindingKey(riderId));
  }

  async markPending(tripId: string, riderId: string, ttlSeconds: number): Promise<void> {
    await this.redis.sadd(pendingKey(tripId), riderId);
    await this.redis.expire(pendingKey(tripId), ttlSeconds * 4);
  }

  async clearPending(tripId: string, riderId: string): Promise<void> {
    await this.redis.srem(pendingKey(tripId), riderId);
  }

  async getPendingCount(tripId: string): Promise<number> {
    return this.redis.scard(pendingKey(tripId));
  }

  async getPendingRiders(tripId: string): Promise<string[]> {
    return this.redis.smembers(pendingKey(tripId));
  }

  async getOfferedRiders(tripId: string): Promise<string[]> {
    return this.redis.smembers(offeredKey(tripId));
  }

  async clearSession(tripId: string): Promise<void> {
    const offered = await this.redis.smembers(offeredKey(tripId));
    const pipeline = this.redis.pipeline();
    for (const riderId of offered) {
      pipeline.del(reservationKey(riderId));
    }
    pipeline.del(offeredKey(tripId));
    pipeline.del(pendingKey(tripId));
    await pipeline.exec();
  }
}

function reservationKey(riderId: string): string {
  return `trip-service:matching:reservation:${riderId}`;
}

function bindingKey(riderId: string): string {
  return `trip-service:matching:binding:${riderId}`;
}

function offeredKey(tripId: string): string {
  return `trip-service:matching:offered:${tripId}`;
}

function pendingKey(tripId: string): string {
  return `trip-service:matching:pending:${tripId}`;
}
