import { z } from 'zod';

export const genderSchema = z.enum(['MALE', 'FEMALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY']);
export const addressLabelSchema = z.enum(['HOME', 'WORK', 'OTHER']);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const idParamsSchema = z.object({
  id: z.string().uuid(),
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
  address: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  isDefault: z.boolean(),
  createdAt: z.date(),
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

export const updateProfileRequestSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    gender: genderSchema.nullable().optional(),
    dateOfBirth: z.coerce.date().nullable().optional(),
    emergencyContactName: z.string().trim().min(1).max(160).nullable().optional(),
    emergencyContactPhone: z.string().trim().min(6).max(20).nullable().optional(),
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
  address: z.string().trim().min(1).max(500),
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

export const updatePreferredLanguageRequestSchema = z.object({
  preferredLanguage: z.string().trim().min(2).max(16),
});

export const apiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
  });

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    meta: z.object({
      pagination: z.object({
        page: z.number().int().positive(),
        limit: z.number().int().positive(),
        total: z.number().int().nonnegative(),
        totalPages: z.number().int().nonnegative(),
      }),
    }),
  });

export const messageResponseSchema = z.object({
  data: z.object({
    message: z.string(),
  }),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type IdParams = z.infer<typeof idParamsSchema>;
export type UserProfileDto = z.infer<typeof userProfileSchema>;
export type AddressDto = z.infer<typeof addressSchema>;
export type FavoriteLocationDto = z.infer<typeof favoriteLocationSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type ProfileImageUpload = z.infer<typeof profileImageUploadSchema> & {
  body: Buffer;
};
export type CreateAddressRequest = z.infer<typeof createAddressRequestSchema>;
export type UpdateAddressRequest = z.infer<typeof updateAddressRequestSchema>;
export type CreateFavoriteLocationRequest = z.infer<typeof createFavoriteLocationRequestSchema>;
export type UpdatePreferredLanguageRequest = z.infer<typeof updatePreferredLanguageRequestSchema>;
