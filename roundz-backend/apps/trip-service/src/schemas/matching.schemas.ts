import { z } from 'zod';
import { vehicleTypeSchema } from './trip.schemas';

export const matchingSessionStatusSchema = z.enum([
  'SEARCHING',
  'DISPATCHING',
  'ASSIGNED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
]);

export const matchingStrategySchema = z.enum(['nearest', 'highest_rated', 'least_busy', 'hybrid']);

/**
 * Validation for tunable matching parameters. The service reads these from
 * config, but exposing the schema keeps radius/batch/timeout bounds in one place
 * and lets future admin overrides reuse the same rules.
 */
export const matchingParamsSchema = z.object({
  searchRadiiMeters: z.array(z.number().int().positive()).min(1),
  batchSize: z.number().int().positive().max(50),
  dispatchTimeoutSeconds: z.number().int().positive().max(120),
});

export const startMatchingBodySchema = z
  .object({
    strategy: matchingStrategySchema.optional(),
  })
  .optional()
  .default({});

export const riderDecisionBodySchema = z.object({
  riderId: z.string().uuid(),
  accepted: z.boolean(),
});

export const matchingSessionSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  status: matchingSessionStatusSchema,
  strategy: z.string(),
  vehicleType: vehicleTypeSchema,
  pickupLatitude: z.number(),
  pickupLongitude: z.number(),
  currentRadiusMeters: z.number().int(),
  maxRadiusMeters: z.number().int(),
  currentBatch: z.number().int(),
  notifiedRiderCount: z.number().int(),
  assignedRiderId: z.string().nullable(),
  failureReason: z.string().nullable(),
  startedAt: z.date(),
  expiresAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type StartMatchingBody = z.infer<typeof startMatchingBodySchema>;
export type RiderDecisionBody = z.infer<typeof riderDecisionBodySchema>;
