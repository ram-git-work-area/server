import type { Trip } from '@prisma/client';

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
};

export interface TripCache {
  getTrip(tripId: string): Promise<Trip | null>;
  setTrip(tripId: string, trip: Trip, ttlSeconds: number): Promise<void>;
  deleteTrip(tripId: string): Promise<void>;
  getActiveTrip(customerId: string): Promise<Trip | null>;
  setActiveTrip(customerId: string, trip: Trip, ttlSeconds: number): Promise<void>;
  deleteActiveTrip(customerId: string): Promise<void>;
}

export class NoopTripCache implements TripCache {
  async getTrip(): Promise<Trip | null> {
    return null;
  }
  async setTrip(): Promise<void> {}
  async deleteTrip(): Promise<void> {}
  async getActiveTrip(): Promise<Trip | null> {
    return null;
  }
  async setActiveTrip(): Promise<void> {}
  async deleteActiveTrip(): Promise<void> {}
}

export class MemoryTripCache implements TripCache {
  private readonly values = new Map<string, { value: string; expiresAt: number }>();

  async getTrip(tripId: string) {
    return this.read(tripKey(tripId));
  }
  async setTrip(tripId: string, trip: Trip, ttlSeconds: number) {
    this.write(tripKey(tripId), trip, ttlSeconds);
  }
  async deleteTrip(tripId: string) {
    this.values.delete(tripKey(tripId));
  }
  async getActiveTrip(customerId: string) {
    return this.read(activeTripKey(customerId));
  }
  async setActiveTrip(customerId: string, trip: Trip, ttlSeconds: number) {
    this.write(activeTripKey(customerId), trip, ttlSeconds);
  }
  async deleteActiveTrip(customerId: string) {
    this.values.delete(activeTripKey(customerId));
  }

  private read(key: string): Trip | null {
    const cached = this.values.get(key);
    if (!cached || cached.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return normalizeTripDates(JSON.parse(cached.value) as Trip);
  }

  private write(key: string, trip: Trip, ttlSeconds: number) {
    this.values.set(key, {
      value: JSON.stringify(trip),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
}

export class RedisTripCache implements TripCache {
  constructor(private readonly redis: RedisLike) {}

  async getTrip(tripId: string) {
    return this.read(tripKey(tripId));
  }
  async setTrip(tripId: string, trip: Trip, ttlSeconds: number) {
    await this.write(tripKey(tripId), trip, ttlSeconds);
  }
  async deleteTrip(tripId: string) {
    await this.redis.del(tripKey(tripId));
  }
  async getActiveTrip(customerId: string) {
    return this.read(activeTripKey(customerId));
  }
  async setActiveTrip(customerId: string, trip: Trip, ttlSeconds: number) {
    await this.write(activeTripKey(customerId), trip, ttlSeconds);
  }
  async deleteActiveTrip(customerId: string) {
    await this.redis.del(activeTripKey(customerId));
  }

  private async read(key: string): Promise<Trip | null> {
    const value = await this.redis.get(key);
    return value ? normalizeTripDates(JSON.parse(value) as Trip) : null;
  }

  private async write(key: string, trip: Trip, ttlSeconds: number) {
    await this.redis.set(key, JSON.stringify(trip), 'EX', ttlSeconds);
  }
}

export function normalizeTripDates(trip: Trip): Trip {
  return {
    ...trip,
    createdAt: new Date(trip.createdAt),
    updatedAt: new Date(trip.updatedAt),
  };
}

function tripKey(tripId: string) {
  return `trip-service:trip:${tripId}`;
}

function activeTripKey(customerId: string) {
  return `trip-service:active:${customerId}`;
}
