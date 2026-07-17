import type { TripVehicleType } from '@prisma/client';
import { AppError } from '@roundz/errors';
import { z } from 'zod';
import { haversineDistanceMeters } from '../utils/geo';
import type { NearbyRider } from '../domain/matching/matching-types';

export type NearbyRiderQuery = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  vehicleType: TripVehicleType;
  limit: number;
  excludeRiderIds?: readonly string[];
};

/**
 * Boundary to the Location Service. The matching engine depends only on this
 * port; it never reads MongoDB or the Location Service's storage directly.
 */
export interface LocationClient {
  findNearbyRiders(query: NearbyRiderQuery): Promise<NearbyRider[]>;
}

const nearbyRiderSchema = z.object({
  riderId: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  distanceMeters: z.number().nonnegative(),
  vehicleType: z
    .enum(['BIKE', 'AUTO', 'CAR', 'SUV', 'VAN', 'TRUCK'])
    .nullish()
    .transform((value) => value ?? null),
  updatedAt: z.string().optional(),
});

const nearbyResponseSchema = z.object({
  data: z.array(nearbyRiderSchema),
});

/**
 * Calls the Location Service HTTP API for nearby riders. The Location Service
 * owns the geospatial index (MongoDB) and Redis presence; matching consumes the
 * results through this API only.
 */
export class HttpLocationClient implements LocationClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 3000,
  ) {}

  async findNearbyRiders(query: NearbyRiderQuery): Promise<NearbyRider[]> {
    const url = new URL('/internal/riders/nearby', this.baseUrl);
    url.searchParams.set('latitude', String(query.latitude));
    url.searchParams.set('longitude', String(query.longitude));
    url.searchParams.set('radiusMeters', String(query.radiusMeters));
    url.searchParams.set('vehicleType', query.vehicleType);
    url.searchParams.set('limit', String(query.limit));
    if (query.excludeRiderIds && query.excludeRiderIds.length > 0) {
      url.searchParams.set('exclude', query.excludeRiderIds.join(','));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AppError(
          `Location Service nearby search failed with status ${response.status}`,
          502,
          'LOCATION_SERVICE_ERROR',
        );
      }

      const body = nearbyResponseSchema.parse(await response.json());
      return body.data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Location Service is unavailable', 503, 'LOCATION_SERVICE_UNAVAILABLE', {
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type SeededRider = {
  riderId: string;
  latitude: number;
  longitude: number;
  vehicleType: TripVehicleType;
  updatedAt?: string;
};

/**
 * In-memory Location client for local runs and tests. Computes distances with
 * Haversine and mirrors the real API's radius/vehicle filtering and ordering.
 */
export class InMemoryLocationClient implements LocationClient {
  constructor(private riders: SeededRider[] = []) {}

  seed(riders: SeededRider[]): void {
    this.riders = riders;
  }

  async findNearbyRiders(query: NearbyRiderQuery): Promise<NearbyRider[]> {
    const exclude = new Set(query.excludeRiderIds ?? []);

    return this.riders
      .filter((rider) => !exclude.has(rider.riderId))
      .filter((rider) => rider.vehicleType === query.vehicleType)
      .map((rider) => ({
        riderId: rider.riderId,
        latitude: rider.latitude,
        longitude: rider.longitude,
        vehicleType: rider.vehicleType,
        updatedAt: rider.updatedAt,
        distanceMeters: haversineDistanceMeters(
          { latitude: query.latitude, longitude: query.longitude },
          { latitude: rider.latitude, longitude: rider.longitude },
        ),
      }))
      .filter((rider) => rider.distanceMeters <= query.radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters || a.riderId.localeCompare(b.riderId))
      .slice(0, query.limit);
  }
}
