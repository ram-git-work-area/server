import { AppError } from '@roundz/errors';
import { KafkaTopics } from '@roundz/kafka';
import { validate } from '@roundz/validation';
import { z } from 'zod';
import type { CurrentLocation, LocationRepositoryPort } from '../repositories/location.repository';
import {
  apiResponseSchema,
  collectionResponseSchema,
  currentLocationSchema,
  historyEntrySchema,
  nearbyRiderSchema,
  presenceSchema,
  updateResultSchema,
  type HistoryQuery,
  type NearbyQuery,
  type UpdateLocationRequest,
} from '../schemas/location.schemas';
import { encodeHistoryCursor } from '../utils/cursor';
import { haversineMeters } from '../utils/geo';
import {
  assertPlausibleImpliedSpeed,
  assertPlausibleReportedSpeed,
  assertValidCoordinates,
} from '../validators/location.validators';
import type { LocationEventName, LocationEventPublisher } from './location-events.publisher';
import type { HistoryWriter } from './history-writer';
import { PRESENCE_SWEEP_LOCK_KEY, type LocationCache } from './location-cache.service';

export type RequestContext = {
  requestId: string;
  traceId?: string;
};

export type LocationServiceConfig = {
  maxSpeedMps: number;
  duplicateEpsilonMeters: number;
  presenceTimeoutSeconds: number;
  currentCacheTtlSeconds: number;
  nearbyMaxRadiusMeters: number;
  nearbyDefaultLimit: number;
  sweepBatchSize: number;
};

export type LocationServiceOptions = {
  repository: LocationRepositoryPort;
  cache: LocationCache;
  eventPublisher: LocationEventPublisher;
  historyWriter: HistoryWriter;
  config: LocationServiceConfig;
};

const nearbyResponseSchema = apiResponseSchema(z.array(nearbyRiderSchema));
const updateResponseSchema = apiResponseSchema(updateResultSchema);

export class LocationService {
  constructor(private readonly options: LocationServiceOptions) {}

  async updateLocation(riderId: string, input: UpdateLocationRequest, context: RequestContext) {
    assertValidCoordinates(input.latitude, input.longitude);
    assertPlausibleReportedSpeed(input.speed, this.options.config.maxSpeedMps);

    const timestamp = input.timestamp ?? new Date();
    const previous = await this.getCachedCurrent(riderId);

    if (previous && timestamp.getTime() <= previous.lastUpdatedAt.getTime()) {
      await this.publish(KafkaTopics.LocationStale, riderId, {
        riderId,
        requestId: context.requestId,
        traceId: context.traceId,
        rejectedTimestamp: timestamp.toISOString(),
        currentTimestamp: previous.lastUpdatedAt.toISOString(),
      });

      return validate(updateResponseSchema, {
        data: { accepted: false, reason: 'stale', location: previous },
      });
    }

    if (previous && this.isDuplicate(previous, input)) {
      const refreshed = await this.persistCurrent(riderId, input, timestamp, previous, 'ONLINE');
      await this.publish(KafkaTopics.LocationHeartbeat, riderId, {
        riderId,
        requestId: context.requestId,
        traceId: context.traceId,
      });

      return validate(updateResponseSchema, {
        data: { accepted: false, reason: 'duplicate', location: refreshed },
      });
    }

    assertPlausibleImpliedSpeed(previous, { ...input, timestamp }, this.options.config.maxSpeedMps);

    const wasOnline = previous?.onlineStatus === 'ONLINE';
    const current = await this.persistCurrent(riderId, input, timestamp, previous, 'ONLINE');

    await this.options.historyWriter.add({
      riderId,
      tripId: input.tripId ?? null,
      latitude: input.latitude,
      longitude: input.longitude,
      heading: input.heading ?? null,
      speed: input.speed ?? null,
      accuracy: input.accuracy ?? null,
      altitude: input.altitude ?? null,
      source: input.source,
      timestamp,
    });

    await this.publish(KafkaTopics.LocationUpdated, riderId, {
      riderId,
      requestId: context.requestId,
      traceId: context.traceId,
      latitude: input.latitude,
      longitude: input.longitude,
      timestamp: timestamp.toISOString(),
    });

    if (!wasOnline) {
      await this.publish(KafkaTopics.LocationOnline, riderId, {
        riderId,
        requestId: context.requestId,
        traceId: context.traceId,
      });
    }

    return validate(updateResponseSchema, {
      data: { accepted: true, reason: null, location: current },
    });
  }

  async heartbeat(riderId: string, context: RequestContext) {
    const previous = await this.getCachedCurrent(riderId);

    if (!previous) {
      throw new AppError('No location recorded for rider', 404, 'LOCATION_NOT_FOUND');
    }

    const wasOnline = previous.onlineStatus === 'ONLINE';
    const timestamp = new Date();
    const current = await this.persistCurrent(
      riderId,
      { latitude: previous.latitude, longitude: previous.longitude },
      timestamp,
      previous,
      'ONLINE',
    );

    await this.publish(KafkaTopics.LocationHeartbeat, riderId, {
      riderId,
      requestId: context.requestId,
      traceId: context.traceId,
    });

    if (!wasOnline) {
      await this.publish(KafkaTopics.LocationOnline, riderId, {
        riderId,
        requestId: context.requestId,
        traceId: context.traceId,
      });
    }

    return validate(apiResponseSchema(presenceSchema), {
      data: {
        riderId,
        onlineStatus: current.onlineStatus,
        lastUpdatedAt: current.lastUpdatedAt,
      },
    });
  }

  async getCurrent(riderId: string) {
    const current = await this.getCachedCurrent(riderId);

    if (!current) {
      throw new AppError('No location recorded for rider', 404, 'LOCATION_NOT_FOUND');
    }

    return validate(apiResponseSchema(currentLocationSchema), { data: current });
  }

  async getRiderCurrent(riderId: string) {
    return this.getCurrent(riderId);
  }

  async getNearby(query: NearbyQuery) {
    const radiusMeters = Math.min(query.radius, this.options.config.nearbyMaxRadiusMeters);
    const limit = query.limit ?? this.options.config.nearbyDefaultLimit;

    const riders = await this.options.repository.findNearby({
      latitude: query.latitude,
      longitude: query.longitude,
      radiusMeters,
      vehicleType: query.vehicleType,
      onlineOnly: query.onlineOnly,
      limit,
    });

    return validate(nearbyResponseSchema, { data: riders });
  }

  async getHistory(query: HistoryQuery, requesterRiderId: string, canQueryOthers: boolean) {
    const riderId =
      query.riderId && (canQueryOthers || query.riderId === requesterRiderId)
        ? query.riderId
        : requesterRiderId;

    if (query.riderId && query.riderId !== riderId) {
      throw new AppError('Not allowed to query another rider history', 403, 'LOCATION_FORBIDDEN');
    }

    const entries = await this.options.repository.listHistory({
      riderId,
      tripId: query.tripId,
      from: query.from,
      to: query.to,
      limit: query.limit,
      cursor: query.cursor,
    });

    const hasMore = entries.length > query.limit;
    const page = hasMore ? entries.slice(0, query.limit) : entries;
    const last = page.at(-1);
    const nextCursor = hasMore && last ? encodeHistoryCursor(last) : null;

    return validate(collectionResponseSchema(historyEntrySchema), {
      data: page,
      meta: {
        pagination: {
          limit: query.limit,
          nextCursor,
          hasMore,
        },
      },
    });
  }

  async sweepStalePresence(context: RequestContext = { requestId: 'presence-sweeper' }) {
    const acquired = await this.options.cache.tryAcquireLock(
      PRESENCE_SWEEP_LOCK_KEY,
      this.options.config.presenceTimeoutSeconds * 1000,
    );

    if (!acquired) {
      return 0;
    }

    const olderThan = new Date(Date.now() - this.options.config.presenceTimeoutSeconds * 1000);
    const stale = await this.options.repository.findStaleOnline(
      olderThan,
      this.options.config.sweepBatchSize,
    );

    for (const rider of stale) {
      const offline = await this.options.repository.setOffline(rider.riderId);

      if (!offline) {
        continue;
      }

      await this.options.cache.deleteCurrent(rider.riderId);
      await this.publish(KafkaTopics.LocationOffline, rider.riderId, {
        riderId: rider.riderId,
        requestId: context.requestId,
        traceId: context.traceId,
        lastUpdatedAt: rider.lastUpdatedAt.toISOString(),
      });
    }

    return stale.length;
  }

  private isDuplicate(previous: CurrentLocation, input: UpdateLocationRequest) {
    if (previous.onlineStatus !== 'ONLINE') {
      return false;
    }

    const distance = haversineMeters(
      previous.latitude,
      previous.longitude,
      input.latitude,
      input.longitude,
    );

    return distance <= this.options.config.duplicateEpsilonMeters;
  }

  private async persistCurrent(
    riderId: string,
    input: {
      latitude: number;
      longitude: number;
      heading?: number;
      speed?: number;
      accuracy?: number;
      altitude?: number;
      vehicleType?: string;
    },
    timestamp: Date,
    previous: CurrentLocation | null,
    onlineStatus: 'ONLINE',
  ) {
    const current = await this.options.repository.upsertCurrent(riderId, {
      latitude: input.latitude,
      longitude: input.longitude,
      heading: input.heading ?? previous?.heading ?? null,
      speed: input.speed ?? null,
      accuracy: input.accuracy ?? previous?.accuracy ?? null,
      altitude: input.altitude ?? previous?.altitude ?? null,
      vehicleType: input.vehicleType ?? previous?.vehicleType ?? null,
      onlineStatus,
      lastUpdatedAt: timestamp,
    });

    await this.options.cache.setCurrent(
      riderId,
      current,
      this.options.config.currentCacheTtlSeconds,
    );
    await this.options.cache.refreshPresence(riderId, this.options.config.presenceTimeoutSeconds);

    return current;
  }

  private async getCachedCurrent(riderId: string): Promise<CurrentLocation | null> {
    const cached = await this.options.cache.getCurrent(riderId);

    if (cached) {
      return cached;
    }

    const current = await this.options.repository.getCurrent(riderId);

    if (current) {
      await this.options.cache.setCurrent(
        riderId,
        current,
        this.options.config.currentCacheTtlSeconds,
      );
    }

    return current;
  }

  private async publish<TPayload extends Record<string, unknown>>(
    topic: LocationEventName,
    key: string,
    payload: TPayload,
  ) {
    await this.options.eventPublisher.publish(topic, key, payload);
  }
}
