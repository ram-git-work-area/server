import { z } from 'zod';

export const authRoleSchema = z.enum(['CUSTOMER', 'RIDER', 'ADMIN', 'SUPPORT']);

export const selfRegistrationRoleSchema = z.enum(['CUSTOMER', 'RIDER']).default('CUSTOMER');

export const safeUserSchema = z.object({
  id: z.string(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  fullName: z.string(),
  role: authRoleSchema,
  status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED', 'PENDING_VERIFICATION']),
  emailVerified: z.boolean(),
  phoneVerified: z.boolean(),
  lastLoginAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresInSeconds: z.number().int().positive(),
  refreshExpiresInSeconds: z.number().int().positive(),
});

export const authResponseSchema = z.object({
  user: safeUserSchema,
  tokens: tokenPairSchema,
});

export const registerRequestSchema = z
  .object({
    email: z.string().email().trim().toLowerCase().optional(),
    phone: z.string().trim().min(6).max(20).optional(),
    password: z.string().min(8).max(128),
    fullName: z.string().trim().min(1).max(160),
    role: selfRegistrationRoleSchema,
  })
  .superRefine((value, ctx) => {
    if (!value.email && !value.phone) {
      ctx.addIssue({
        code: 'custom',
        message: 'Either email or phone is required',
        path: ['email'],
      });
    }
  });

export const loginRequestSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(1).max(128),
});

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutRequestSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const otpRequestSchema = z.object({
  phone: z.string().trim().min(6).max(20),
  purpose: z.enum(['LOGIN', 'REGISTER']).default('LOGIN'),
});

export const otpVerifyRequestSchema = z.object({
  phone: z.string().trim().min(6).max(20),
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/),
  purpose: z.enum(['LOGIN', 'REGISTER']).default('LOGIN'),
  fullName: z.string().trim().min(1).max(160).optional(),
  role: selfRegistrationRoleSchema,
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export const forgotPasswordRequestSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
});

export const verifyEmailRequestSchema = z.object({
  token: z.string().min(1),
});

export const messageResponseSchema = z.object({
  message: z.string(),
});

export const otpRequestResponseSchema = z.object({
  message: z.string(),
  expiresInSeconds: z.number().int().positive(),
});

export type AuthRole = z.infer<typeof authRoleSchema>;
export type SafeUser = z.infer<typeof safeUserSchema>;
export type TokenPair = z.infer<typeof tokenPairSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
export type OtpRequest = z.infer<typeof otpRequestSchema>;
export type OtpVerifyRequest = z.infer<typeof otpVerifyRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;
