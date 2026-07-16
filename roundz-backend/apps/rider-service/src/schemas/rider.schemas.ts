import { z } from 'zod';

export const riderStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']);
export const riderOnboardingStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']);
export const riderApprovalStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export const riderOnlineStatusSchema = z.enum(['ONLINE', 'OFFLINE', 'BUSY']);
export const vehicleTypeSchema = z.enum(['BIKE', 'AUTO', 'CAR', 'SUV', 'VAN', 'TRUCK']);
export const riderDocumentTypeSchema = z.enum([
  'DRIVING_LICENSE',
  'VEHICLE_RC',
  'INSURANCE',
  'PERMIT',
  'PROFILE_PHOTO',
  'IDENTITY_PROOF',
  'ADDRESS_PROOF',
]);
export const documentVerificationStatusSchema = z.enum(['PENDING', 'VERIFIED', 'REJECTED']);

export const idParamsSchema = z.object({
  id: z.string().uuid(),
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export const riderProfileSchema = z.object({
  id: z.string(),
  userId: z.string(),
  riderCode: z.string(),
  status: riderStatusSchema,
  onboardingStatus: riderOnboardingStatusSchema,
  approvalStatus: riderApprovalStatusSchema,
  onlineStatus: riderOnlineStatusSchema,
  profilePhoto: z.string().nullable(),
  rating: z.number(),
  totalTrips: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const riderStatusResponseSchema = z.object({
  onlineStatus: riderOnlineStatusSchema,
  onboardingStatus: riderOnboardingStatusSchema,
  approvalStatus: riderApprovalStatusSchema,
});

export const vehicleSchema = z.object({
  id: z.string(),
  riderId: z.string(),
  vehicleType: vehicleTypeSchema,
  brand: z.string(),
  model: z.string(),
  color: z.string(),
  registrationNumber: z.string(),
  registrationState: z.string(),
  manufacturingYear: z.number(),
  insuranceExpiry: z.date().nullable(),
  permitExpiry: z.date().nullable(),
  isPrimary: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const riderDocumentSchema = z.object({
  id: z.string(),
  riderId: z.string(),
  documentType: riderDocumentTypeSchema,
  fileUrl: z.string(),
  verificationStatus: documentVerificationStatusSchema,
  rejectionReason: z.string().nullable(),
  uploadedAt: z.date(),
  verifiedAt: z.date().nullable(),
});

export const riderPreferenceSchema = z.object({
  id: z.string(),
  riderId: z.string(),
  preferredLanguage: z.string(),
  autoAcceptTrips: z.boolean(),
  receivePromotions: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const currentYear = new Date().getFullYear();

export const updateProfileRequestSchema = z
  .object({
    profilePhoto: z.string().trim().min(1).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one profile field is required',
  });

export const createVehicleRequestSchema = z.object({
  vehicleType: vehicleTypeSchema,
  brand: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(80),
  color: z.string().trim().min(1).max(40),
  registrationNumber: z.string().trim().min(3).max(32),
  registrationState: z.string().trim().min(1).max(80),
  manufacturingYear: z
    .number()
    .int()
    .min(1980)
    .max(currentYear + 1),
  insuranceExpiry: z.coerce.date().nullable().optional(),
  permitExpiry: z.coerce.date().nullable().optional(),
  isPrimary: z.boolean().default(false),
});

export const updateVehicleRequestSchema = createVehicleRequestSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one vehicle field is required',
  });

export const uploadDocumentRequestSchema = z.object({
  documentType: riderDocumentTypeSchema,
  fileName: z.string().min(1).max(255),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
});

export const updateStatusRequestSchema = z.object({
  onlineStatus: riderOnlineStatusSchema,
});

export const updatePreferencesRequestSchema = z
  .object({
    preferredLanguage: z.string().trim().min(2).max(16).optional(),
    autoAcceptTrips: z.boolean().optional(),
    receivePromotions: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one preference field is required',
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

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type CreateVehicleRequest = z.infer<typeof createVehicleRequestSchema>;
export type UpdateVehicleRequest = z.infer<typeof updateVehicleRequestSchema>;
export type UploadDocumentRequest = z.infer<typeof uploadDocumentRequestSchema>;
export type DocumentUpload = z.infer<typeof uploadDocumentRequestSchema> & { body: Buffer };
export type UpdateStatusRequest = z.infer<typeof updateStatusRequestSchema>;
export type UpdatePreferencesRequest = z.infer<typeof updatePreferencesRequestSchema>;
