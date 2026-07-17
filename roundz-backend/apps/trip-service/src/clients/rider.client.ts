import { AppError } from '@roundz/errors';
import { z } from 'zod';
import type { RiderEligibilitySnapshot } from '../domain/matching/matching-types';

/**
 * Boundary to the Rider Service. Provides the authoritative eligibility snapshot
 * used to gate dispatch. Matching caches these in Redis to keep DB reads low.
 */
export interface RiderClient {
  getEligibility(riderId: string): Promise<RiderEligibilitySnapshot | null>;
  getEligibilityBatch(riderIds: readonly string[]): Promise<Map<string, RiderEligibilitySnapshot>>;
}

const eligibilitySchema = z.object({
  riderId: z.string().min(1),
  status: z.string().min(1),
  approvalStatus: z.string().min(1),
  onlineStatus: z.string().min(1),
  isBusy: z.boolean(),
  hasActiveTrip: z.boolean(),
  primaryVehicleType: z
    .enum(['BIKE', 'AUTO', 'CAR', 'SUV', 'VAN', 'TRUCK'])
    .nullish()
    .transform((value) => value ?? null),
  hasCurrentLocation: z.boolean(),
  rating: z.number().min(0).max(5).default(0),
  activeTripCount: z.number().int().nonnegative().default(0),
});

const eligibilityResponseSchema = z.object({ data: eligibilitySchema });

export class HttpRiderClient implements RiderClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 3000,
  ) {}

  async getEligibility(riderId: string): Promise<RiderEligibilitySnapshot | null> {
    const url = new URL(
      `/internal/riders/${encodeURIComponent(riderId)}/availability`,
      this.baseUrl,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });

      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new AppError(
          `Rider Service availability lookup failed with status ${response.status}`,
          502,
          'RIDER_SERVICE_ERROR',
        );
      }

      return eligibilityResponseSchema.parse(await response.json()).data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Rider Service is unavailable', 503, 'RIDER_SERVICE_UNAVAILABLE', {
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async getEligibilityBatch(
    riderIds: readonly string[],
  ): Promise<Map<string, RiderEligibilitySnapshot>> {
    const entries = await Promise.all(
      riderIds.map(async (riderId) => [riderId, await this.getEligibility(riderId)] as const),
    );

    const result = new Map<string, RiderEligibilitySnapshot>();
    for (const [riderId, snapshot] of entries) {
      if (snapshot) {
        result.set(riderId, snapshot);
      }
    }
    return result;
  }
}

/** In-memory Rider client for local runs and tests. */
export class InMemoryRiderClient implements RiderClient {
  private readonly snapshots = new Map<string, RiderEligibilitySnapshot>();

  constructor(snapshots: RiderEligibilitySnapshot[] = []) {
    this.seed(snapshots);
  }

  seed(snapshots: RiderEligibilitySnapshot[]): void {
    for (const snapshot of snapshots) {
      this.snapshots.set(snapshot.riderId, snapshot);
    }
  }

  set(snapshot: RiderEligibilitySnapshot): void {
    this.snapshots.set(snapshot.riderId, snapshot);
  }

  async getEligibility(riderId: string): Promise<RiderEligibilitySnapshot | null> {
    return this.snapshots.get(riderId) ?? null;
  }

  async getEligibilityBatch(
    riderIds: readonly string[],
  ): Promise<Map<string, RiderEligibilitySnapshot>> {
    const result = new Map<string, RiderEligibilitySnapshot>();
    for (const riderId of riderIds) {
      const snapshot = this.snapshots.get(riderId);
      if (snapshot) {
        result.set(riderId, snapshot);
      }
    }
    return result;
  }
}
