import { z } from 'zod';
import { TRIP_STATUSES } from '../domain/trip-state-machine';

export const tripStatusSchema = z.enum(TRIP_STATUSES);
export const vehicleTypeSchema = z.enum(['BIKE', 'AUTO', 'CAR', 'SUV', 'VAN', 'TRUCK']);
export const tripTypeSchema = z.enum(['RIDE', 'DELIVERY']);
export const paymentMethodSchema = z.enum(['CASH', 'WALLET', 'CARD', 'UPI']);
export const cancelledBySchema = z.enum(['CUSTOMER', 'RIDER', 'SYSTEM', 'ADMIN']);

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const idParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createTripRequestSchema = z.object({
  vehicleType: vehicleTypeSchema,
  tripType: tripTypeSchema.default('RIDE'),
  pickupLatitude: latitudeSchema,
  pickupLongitude: longitudeSchema,
  pickupAddress: z.string().trim().min(1).max(500),
  dropLatitude: latitudeSchema,
  dropLongitude: longitudeSchema,
  dropAddress: z.string().trim().min(1).max(500),
  estimatedDistance: z.number().nonnegative(),
  estimatedDuration: z.number().int().nonnegative(),
  estimatedFare: z.number().nonnegative(),
  paymentMethod: paymentMethodSchema,
});

export const cancelTripRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const updateStatusRequestSchema = z.object({
  status: tripStatusSchema,
  description: z.string().trim().min(1).max(500).optional(),
  riderId: z.string().uuid().optional(),
  cancellationReason: z.string().trim().min(1).max(500).optional(),
  cancelledBy: cancelledBySchema.optional(),
  actualFare: z.number().nonnegative().optional(),
});

export const listTripsQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(100).default(20),
    cursor: z.string().uuid().optional(),
    status: tripStatusSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must be earlier than or equal to to',
    path: ['from'],
  });

export const tripSchema = z.object({
  id: z.string(),
  tripNumber: z.string(),
  customerId: z.string(),
  riderId: z.string().nullable(),
  vehicleType: vehicleTypeSchema,
  tripType: tripTypeSchema,
  status: tripStatusSchema,
  pickupLatitude: z.number(),
  pickupLongitude: z.number(),
  pickupAddress: z.string(),
  dropLatitude: z.number(),
  dropLongitude: z.number(),
  dropAddress: z.string(),
  estimatedDistance: z.number(),
  estimatedDuration: z.number(),
  estimatedFare: z.number(),
  actualFare: z.number().nullable(),
  paymentMethod: paymentMethodSchema,
  cancellationReason: z.string().nullable(),
  cancelledBy: cancelledBySchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
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

export type CreateTripRequest = z.infer<typeof createTripRequestSchema>;
export type CancelTripRequest = z.infer<typeof cancelTripRequestSchema>;
export type UpdateStatusRequest = z.infer<typeof updateStatusRequestSchema>;
export type ListTripsQuery = z.infer<typeof listTripsQuerySchema>;
