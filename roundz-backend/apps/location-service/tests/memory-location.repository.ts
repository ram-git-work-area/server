import { Types } from 'mongoose';
import type {
  CurrentLocation,
  HistoryEntry,
  HistoryInput,
  HistoryQueryParams,
  LocationRepositoryPort,
  NearbyParams,
  UpsertCurrentInput,
} from '../src/repositories/location.repository';
import type {
  LocationEventName,
  LocationEventPublisher,
} from '../src/services/location-events.publisher';
import { MemoryLocationCache } from '../src/services/location-cache.service';
import { decodeHistoryCursor } from '../src/utils/cursor';
import { haversineMeters } from '../src/utils/geo';

export class MemoryLocationRepository implements LocationRepositoryPort {
  public current = new Map<string, CurrentLocation>();
  public history: HistoryEntry[] = [];

  async getCurrent(riderId: string) {
    return this.current.get(riderId) ?? null;
  }

  async upsertCurrent(riderId: string, input: UpsertCurrentInput) {
    const location: CurrentLocation = {
      riderId,
      latitude: input.latitude,
      longitude: input.longitude,
      heading: input.heading,
      speed: input.speed,
      accuracy: input.accuracy,
      altitude: input.altitude,
      vehicleType: input.vehicleType,
      onlineStatus: input.onlineStatus,
      lastUpdatedAt: input.lastUpdatedAt,
    };
    this.current.set(riderId, location);
    return location;
  }

  async setOffline(riderId: string) {
    const existing = this.current.get(riderId);

    if (!existing || existing.onlineStatus !== 'ONLINE') {
      return null;
    }

    existing.onlineStatus = 'OFFLINE';
    return existing;
  }

  async findNearby(params: NearbyParams) {
    return [...this.current.values()]
      .filter((location) => (params.onlineOnly ? location.onlineStatus === 'ONLINE' : true))
      .filter((location) =>
        params.vehicleType ? location.vehicleType === params.vehicleType : true,
      )
      .map((location) => ({
        ...location,
        distanceMeters: Math.round(
          haversineMeters(params.latitude, params.longitude, location.latitude, location.longitude),
        ),
      }))
      .filter((location) => location.distanceMeters <= params.radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, params.limit);
  }

  async findStaleOnline(olderThan: Date, limit: number) {
    return [...this.current.values()]
      .filter(
        (location) =>
          location.onlineStatus === 'ONLINE' &&
          location.lastUpdatedAt.getTime() < olderThan.getTime(),
      )
      .slice(0, limit);
  }

  async appendHistoryMany(entries: HistoryInput[]) {
    for (const entry of entries) {
      this.history.push({
        id: new Types.ObjectId().toString(),
        riderId: entry.riderId,
        tripId: entry.tripId,
        latitude: entry.latitude,
        longitude: entry.longitude,
        heading: entry.heading,
        speed: entry.speed,
        accuracy: entry.accuracy,
        altitude: entry.altitude,
        source: entry.source,
        timestamp: entry.timestamp,
      });
    }
  }

  async listHistory(params: HistoryQueryParams) {
    const cursor = params.cursor ? decodeHistoryCursor(params.cursor) : null;

    return this.history
      .filter((entry) => (params.riderId ? entry.riderId === params.riderId : true))
      .filter((entry) => (params.tripId ? entry.tripId === params.tripId : true))
      .filter((entry) => (params.from ? entry.timestamp.getTime() >= params.from.getTime() : true))
      .filter((entry) => (params.to ? entry.timestamp.getTime() <= params.to.getTime() : true))
      .filter((entry) => {
        if (!cursor) {
          return true;
        }

        if (entry.timestamp.getTime() < cursor.timestampMs) {
          return true;
        }

        return entry.timestamp.getTime() === cursor.timestampMs && entry.id < cursor.id;
      })
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime() || b.id.localeCompare(a.id))
      .slice(0, params.limit + 1);
  }
}

export class MemoryLocationEventPublisher implements LocationEventPublisher {
  public events: Array<{
    topic: LocationEventName;
    key: string;
    payload: Record<string, unknown>;
  }> = [];

  async publish<TPayload extends Record<string, unknown>>(
    topic: LocationEventName,
    key: string,
    payload: TPayload,
  ) {
    this.events.push({ topic, key, payload });
  }

  topics() {
    return this.events.map((event) => event.topic);
  }
}

export { MemoryLocationCache };
