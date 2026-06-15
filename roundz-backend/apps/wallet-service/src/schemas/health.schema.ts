import { z } from 'zod';

export const healthResponseSchema = z.object({
  service: z.string(),
  status: z.enum(['ok', 'degraded', 'unavailable']),
  timestamp: z.string(),
  uptimeSeconds: z.number(),
  dependencies: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['up', 'down', 'unknown']),
      latencyMs: z.number().optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});
