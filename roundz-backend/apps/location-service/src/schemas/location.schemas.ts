import { z } from 'zod';

export const vehicleTypeSchema = z.enum(['BIKE', 'AUTO', 'CAR', 'SUV', 'VAN', 'TRUCK']);
export const onlineStatusSchema = z.enum(['ONLINE', 'OFFLINE']);
export const locationSourceSchema = z.enum(['GPS', 'NETWORK', 'MOCK']);

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const riderIdParamsSchema = z.object({
  riderId: z.string().uuid(),
});

export const updateLocationRequestSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
  accuracy: z.number().min(0).optional(),
  altitude: z.number().optional(),
  source: locationSourceSchema.default('GPS'),
  tripId: z.string().uuid().nullable().optional(),
  vehicleType: vehicleTypeSchema.optional(),
  timestamp: z.coerce.date().optional(),
});

export const nearbyQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive(),
  vehicleType: vehicleTypeSchema.optional(),
  onlineOnly: z.coerce.boolean().default(true),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export const historyQuerySchema = z
  .object({
    riderId: z.string().uuid().optional(),
    tripId: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().positive().max(200).default(50),
    cursor: z.string().min(1).optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must be earlier than or equal to to',
    path: ['from'],
  });

export const currentLocationSchema = z.object({
  riderId: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  heading: z.number().nullable(),
  speed: z.number().nullable(),
  accuracy: z.number().nullable(),
  altitude: z.number().nullable(),
  vehicleType: vehicleTypeSchema.nullable(),
  onlineStatus: onlineStatusSchema,
  lastUpdatedAt: z.date(),
});

export const nearbyRiderSchema = z.object({
  riderId: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  vehicleType: vehicleTypeSchema.nullable(),
  onlineStatus: onlineStatusSchema,
  lastUpdatedAt: z.date(),
  distanceMeters: z.number(),
});

export const historyEntrySchema = z.object({
  id: z.string(),
  riderId: z.string(),
  tripId: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  heading: z.number().nullable(),
  speed: z.number().nullable(),
  accuracy: z.number().nullable(),
  altitude: z.number().nullable(),
  source: locationSourceSchema,
  timestamp: z.date(),
});

export const updateResultSchema = z.object({
  accepted: z.boolean(),
  reason: z.string().nullable(),
  location: currentLocationSchema,
});

export const presenceSchema = z.object({
  riderId: z.string(),
  onlineStatus: onlineStatusSchema,
  lastUpdatedAt: z.date(),
});

export const apiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
  });

export const collectionResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    meta: z.object({
      pagination: z.object({
        limit: z.number().int().positive(),
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      }),
    }),
  });

export const messageResponseSchema = z.object({
  data: z.object({
    message: z.string(),
  }),
});

export type UpdateLocationRequest = z.infer<typeof updateLocationRequestSchema>;
export type NearbyQuery = z.infer<typeof nearbyQuerySchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type VehicleType = z.infer<typeof vehicleTypeSchema>;
