import { z } from 'zod';

export const genderSchema = z.enum(['MALE', 'FEMALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY']);
export const addressLabelSchema = z.enum(['HOME', 'WORK', 'OTHER']);

export const idParamsSchema = z.object({
  id: z.string().uuid(),
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export const userProfileSchema = z.object({
  id: z.string(),
  userId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  gender: genderSchema.nullable(),
  profileImageUrl: z.string().nullable(),
  dateOfBirth: z.date().nullable(),
  emergencyContactName: z.string().nullable(),
  emergencyContactPhone: z.string().nullable(),
  preferredLanguage: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const addressSchema = z.object({
  id: z.string(),
  userId: z.string(),
  label: addressLabelSchema,
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  country: z.string(),
  postalCode: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  isDefault: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const favoriteLocationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  address: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  createdAt: z.date(),
});

export const userSettingsSchema = z.object({
  id: z.string(),
  userId: z.string(),
  pushNotificationsEnabled: z.boolean(),
  marketingNotificationsEnabled: z.boolean(),
  emailNotificationsEnabled: z.boolean(),
  darkModeEnabled: z.boolean(),
  language: z.string(),
  timezone: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const updateProfileRequestSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    gender: genderSchema.nullable().optional(),
    profileImageUrl: z.string().trim().min(1).nullable().optional(),
    dateOfBirth: z.coerce.date().nullable().optional(),
    emergencyContactName: z.string().trim().min(1).max(160).nullable().optional(),
    emergencyContactPhone: z.string().trim().min(6).max(20).nullable().optional(),
    preferredLanguage: z.string().trim().min(2).max(16).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one profile field is required',
  });

export const profileImageUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});

export const createAddressRequestSchema = z.object({
  label: addressLabelSchema,
  addressLine1: z.string().trim().min(1).max(255),
  addressLine2: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().min(1).max(120),
  country: z.string().trim().min(2).max(120),
  postalCode: z.string().trim().min(2).max(32),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  isDefault: z.boolean().default(false),
});

export const updateAddressRequestSchema = createAddressRequestSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one address field is required',
  });

export const createFavoriteLocationRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const updateFavoriteLocationRequestSchema = createFavoriteLocationRequestSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one favorite location field is required',
  });

export const updateSettingsRequestSchema = z
  .object({
    pushNotificationsEnabled: z.boolean().optional(),
    marketingNotificationsEnabled: z.boolean().optional(),
    emailNotificationsEnabled: z.boolean().optional(),
    darkModeEnabled: z.boolean().optional(),
    language: z.string().trim().min(2).max(16).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one settings field is required',
  });

export const updateEmergencyContactRequestSchema = z.object({
  emergencyContactName: z.string().trim().min(1).max(160),
  emergencyContactPhone: z.string().trim().min(6).max(20),
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
export type ProfileImageUpload = z.infer<typeof profileImageUploadSchema> & { body: Buffer };
export type CreateAddressRequest = z.infer<typeof createAddressRequestSchema>;
export type UpdateAddressRequest = z.infer<typeof updateAddressRequestSchema>;
export type CreateFavoriteLocationRequest = z.infer<typeof createFavoriteLocationRequestSchema>;
export type UpdateFavoriteLocationRequest = z.infer<typeof updateFavoriteLocationRequestSchema>;
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
export type UpdateEmergencyContactRequest = z.infer<typeof updateEmergencyContactRequestSchema>;
