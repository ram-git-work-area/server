import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { SignOptions } from 'jsonwebtoken';
import type { OtpPurpose, User } from '@prisma/client';
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type AuthRole,
} from '@roundz/auth';
import { AppError } from '@roundz/errors';
import { KafkaTopics } from '@roundz/kafka';
import { validate } from '@roundz/validation';
import {
  authResponseSchema,
  messageResponseSchema,
  otpRequestResponseSchema,
  tokenPairSchema,
  type AuthResponse,
  type ChangePasswordRequest,
  type ForgotPasswordRequest,
  type LoginRequest,
  type LogoutRequest,
  type OtpRequest,
  type OtpVerifyRequest,
  type RefreshRequest,
  type RegisterRequest,
  type SafeUser,
  type TokenPair,
  type VerifyEmailRequest,
} from '../schemas/auth.schemas';
import type { AuthEventPublisher } from './auth-events.publisher';
import type { AuthNotificationProvider } from './notification.provider';
import type { AuthRateLimiter } from './rate-limiter.service';
import type { AuthRepositoryPort } from '../repositories/auth.repository';

export type AuthRequestContext = {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
};

export type AuthServiceOptions = {
  repository: AuthRepositoryPort;
  jwtSecret: string;
  accessTokenExpiresIn: SignOptions['expiresIn'];
  refreshTokenExpiresIn: SignOptions['expiresIn'];
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  loginRateLimitMax: number;
  loginRateLimitWindowSeconds: number;
  otpRateLimitMax: number;
  otpRateLimitWindowSeconds: number;
  otpTtlSeconds: number;
  rateLimiter: AuthRateLimiter;
  eventPublisher: AuthEventPublisher;
  notificationProvider: AuthNotificationProvider;
};

export class AuthService {
  constructor(private readonly options: AuthServiceOptions) {}

  async register(input: RegisterRequest, context: AuthRequestContext): Promise<AuthResponse> {
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);

    if (email && (await this.options.repository.findUserByEmail(email))) {
      throw new AppError('User already exists', 409, 'AUTH_USER_EXISTS');
    }

    if (phone && (await this.options.repository.findUserByPhone(phone))) {
      throw new AppError('User already exists', 409, 'AUTH_USER_EXISTS');
    }

    const passwordHash = await argon2.hash(input.password);
    const user = await this.options.repository.createUser({
      email,
      phone,
      passwordHash,
      fullName: input.fullName,
      role: input.role,
      status: 'PENDING_VERIFICATION',
    });

    await this.publishEvent(KafkaTopics.AuthUserRegistered, user.id, {
      userId: user.id,
      role: user.role,
      requestId: context.requestId,
    });

    return validate(authResponseSchema, {
      user: toSafeUser(user),
      tokens: await this.issueTokenPair(user, context),
    });
  }

  async login(input: LoginRequest, context: AuthRequestContext): Promise<AuthResponse> {
    const email = normalizeEmail(input.email);

    if (!email) {
      throw invalidLoginError();
    }

    await this.options.rateLimiter.assertAllowed({
      key: `auth:login:${email}:${context.ipAddress ?? 'unknown'}`,
      limit: this.options.loginRateLimitMax,
      windowSeconds: this.options.loginRateLimitWindowSeconds,
    });

    const user = await this.options.repository.findUserByEmail(email);

    if (!user?.passwordHash) {
      await this.recordLoginAttempt(email, undefined, false, 'invalid_credentials', context);
      throw invalidLoginError();
    }

    const passwordMatches = await argon2.verify(user.passwordHash, input.password);

    if (!passwordMatches) {
      await this.recordLoginAttempt(email, user.id, false, 'invalid_credentials', context);
      throw invalidLoginError();
    }

    ensureUserCanAuthenticate(user);

    const loggedInAt = new Date();
    await this.options.repository.updateLastLoginAt(user.id, loggedInAt);
    await this.recordLoginAttempt(email, user.id, true, undefined, context);

    await this.publishEvent(KafkaTopics.AuthUserLoggedIn, user.id, {
      userId: user.id,
      role: user.role,
      requestId: context.requestId,
    });

    const userWithLoginAt = {
      ...user,
      lastLoginAt: loggedInAt,
    };

    return validate(authResponseSchema, {
      user: toSafeUser(userWithLoginAt),
      tokens: await this.issueTokenPair(user, context),
    });
  }

  async refresh(input: RefreshRequest, context: AuthRequestContext): Promise<TokenPair> {
    const payload = this.parseRefreshToken(input.refreshToken);
    const tokenHash = hashToken(input.refreshToken);
    const storedToken = await this.options.repository.findRefreshTokenByHash(tokenHash);
    const now = new Date();

    if (
      !storedToken ||
      storedToken.id !== payload.tokenId ||
      storedToken.revokedAt ||
      storedToken.expiresAt <= now ||
      storedToken.session?.revokedAt ||
      !storedToken.session ||
      storedToken.session.expiresAt <= now
    ) {
      throw new AppError('Invalid refresh token', 401, 'AUTH_REFRESH_TOKEN_INVALID');
    }

    ensureUserCanAuthenticate(storedToken.user);

    await this.options.repository.revokeRefreshToken(storedToken.id, now);

    return validate(
      tokenPairSchema,
      await this.issueTokenPair(storedToken.user, context, storedToken.session.id),
    );
  }

  async logout(
    input: LogoutRequest,
    authUser: { sub: string; sessionId?: string } | null,
  ): Promise<{ message: string }> {
    const revokedAt = new Date();

    if (input.refreshToken) {
      const storedToken = await this.options.repository.findRefreshTokenByHash(
        hashToken(input.refreshToken),
      );

      if (storedToken) {
        await this.options.repository.revokeRefreshToken(storedToken.id, revokedAt);
      }
    }

    if (authUser?.sessionId) {
      await this.options.repository.revokeSession(authUser.sessionId, revokedAt);
    }

    return validate(messageResponseSchema, { message: 'Logged out successfully' });
  }

  async me(authUser: { sub: string }): Promise<SafeUser> {
    const user = await this.options.repository.findUserById(authUser.sub);

    if (!user) {
      throw new AppError('Authenticated user not found', 404, 'AUTH_USER_NOT_FOUND');
    }

    return validate(authResponseSchema.shape.user, toSafeUser(user));
  }

  async changePassword(
    authUser: { sub: string },
    input: ChangePasswordRequest,
    context: AuthRequestContext,
  ): Promise<{ message: string }> {
    const user = await this.options.repository.findUserById(authUser.sub);

    if (!user?.passwordHash) {
      throw new AppError(
        'Password change is not available for this account',
        400,
        'AUTH_PASSWORD_UNAVAILABLE',
      );
    }

    const currentPasswordMatches = await argon2.verify(user.passwordHash, input.currentPassword);

    if (!currentPasswordMatches) {
      throw invalidLoginError();
    }

    const passwordHash = await argon2.hash(input.newPassword);
    await this.options.repository.updatePassword(user.id, passwordHash);
    await this.options.repository.revokeUserRefreshTokens(user.id, new Date());
    await this.options.repository.revokeUserSessions(user.id, new Date());

    await this.publishEvent(KafkaTopics.AuthPasswordChanged, user.id, {
      userId: user.id,
      requestId: context.requestId,
    });

    return validate(messageResponseSchema, { message: 'Password changed successfully' });
  }

  async requestOtp(input: OtpRequest, context: AuthRequestContext) {
    const phone = normalizePhone(input.phone);

    if (!phone) {
      throw new AppError('Phone is required', 400, 'AUTH_PHONE_REQUIRED');
    }

    await this.options.rateLimiter.assertAllowed({
      key: `auth:otp:${phone}`,
      limit: this.options.otpRateLimitMax,
      windowSeconds: this.options.otpRateLimitWindowSeconds,
    });

    const user = await this.options.repository.findUserByPhone(phone);
    const code = '000000';
    const expiresAt = new Date(Date.now() + this.options.otpTtlSeconds * 1000);

    await this.options.repository.createOtpCode({
      userId: user?.id,
      destination: phone,
      purpose: input.purpose as OtpPurpose,
      codeHash: hashOtpCode(phone, input.purpose, code),
      expiresAt,
    });

    await this.options.notificationProvider.sendOtp({
      destination: phone,
      code,
      purpose: input.purpose,
    });

    await this.publishEvent(KafkaTopics.AuthOtpRequested, phone, {
      phone,
      purpose: input.purpose,
      requestId: context.requestId,
    });

    return validate(otpRequestResponseSchema, {
      message: 'OTP request accepted',
      expiresInSeconds: this.options.otpTtlSeconds,
    });
  }

  async verifyOtp(input: OtpVerifyRequest, context: AuthRequestContext): Promise<AuthResponse> {
    const phone = normalizePhone(input.phone);

    if (!phone) {
      throw new AppError('Phone is required', 400, 'AUTH_PHONE_REQUIRED');
    }

    const purpose = input.purpose as OtpPurpose;
    const otp = await this.options.repository.findValidOtp({
      destination: phone,
      purpose,
      codeHash: hashOtpCode(phone, input.purpose, input.code),
      now: new Date(),
    });

    if (!otp) {
      throw new AppError('Invalid or expired OTP', 401, 'AUTH_OTP_INVALID');
    }

    await this.options.repository.consumeOtp(otp.id, new Date());

    let user = await this.options.repository.findUserByPhone(phone);
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = await this.options.repository.createUser({
        phone,
        fullName: input.fullName ?? 'Roundz User',
        role: input.role,
        status: 'ACTIVE',
        phoneVerified: true,
      });
    } else if (!user.phoneVerified || user.status === 'PENDING_VERIFICATION') {
      user = await this.options.repository.markPhoneVerified(user.id);
    }

    ensureUserCanAuthenticate(user);
    await this.options.repository.updateLastLoginAt(user.id, new Date());

    if (isNewUser) {
      await this.publishEvent(KafkaTopics.AuthUserRegistered, user.id, {
        userId: user.id,
        role: user.role,
        requestId: context.requestId,
      });
    }

    await this.publishEvent(KafkaTopics.AuthUserLoggedIn, user.id, {
      userId: user.id,
      role: user.role,
      requestId: context.requestId,
    });

    return validate(authResponseSchema, {
      user: toSafeUser(user),
      tokens: await this.issueTokenPair(user, context),
    });
  }

  async forgotPassword(_input: ForgotPasswordRequest): Promise<{ message: string }> {
    return validate(messageResponseSchema, {
      message: 'If the account exists, password reset instructions will be sent',
    });
  }

  async verifyEmail(_input: VerifyEmailRequest): Promise<{ message: string }> {
    return validate(messageResponseSchema, {
      message: 'Email verification placeholder accepted',
    });
  }

  private async issueTokenPair(
    user: User,
    context: AuthRequestContext,
    existingSessionId?: string,
  ): Promise<TokenPair> {
    const refreshExpiresAt = new Date(Date.now() + this.options.refreshTokenTtlSeconds * 1000);
    const sessionId =
      existingSessionId ??
      (
        await this.options.repository.createSession({
          userId: user.id,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          expiresAt: refreshExpiresAt,
        })
      ).id;
    const tokenId = randomUUID();
    const accessToken = signAccessToken(
      {
        sub: user.id,
        role: user.role as AuthRole,
        sessionId,
      },
      this.options.jwtSecret,
      this.options.accessTokenExpiresIn,
    );
    const refreshToken = signRefreshToken(
      {
        sub: user.id,
        role: user.role as AuthRole,
        sessionId,
        tokenId,
      },
      this.options.jwtSecret,
      this.options.refreshTokenExpiresIn,
    );

    await this.options.repository.createRefreshToken({
      id: tokenId,
      tokenHash: hashToken(refreshToken),
      userId: user.id,
      sessionId,
      expiresAt: refreshExpiresAt,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresInSeconds: this.options.accessTokenTtlSeconds,
      refreshExpiresInSeconds: this.options.refreshTokenTtlSeconds,
    };
  }

  private async recordLoginAttempt(
    identifier: string,
    userId: string | undefined,
    success: boolean,
    failureReason: string | undefined,
    context: AuthRequestContext,
  ) {
    await this.options.repository.createLoginAttempt({
      identifier,
      userId,
      success,
      failureReason,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  private async publishEvent<TPayload extends Record<string, unknown>>(
    topic:
      | typeof KafkaTopics.AuthUserRegistered
      | typeof KafkaTopics.AuthUserLoggedIn
      | typeof KafkaTopics.AuthOtpRequested
      | typeof KafkaTopics.AuthPasswordChanged,
    key: string,
    payload: TPayload,
  ) {
    await this.options.eventPublisher.publish(topic, key, payload);
  }

  private parseRefreshToken(refreshToken: string) {
    try {
      return verifyRefreshToken(refreshToken, this.options.jwtSecret);
    } catch {
      throw new AppError('Invalid refresh token', 401, 'AUTH_REFRESH_TOKEN_INVALID');
    }
  }
}

function normalizeEmail(email: string | undefined) {
  return email?.trim().toLowerCase();
}

function normalizePhone(phone: string | undefined) {
  const normalized = phone?.trim();
  return normalized ? normalized : undefined;
}

function invalidLoginError() {
  return new AppError('Invalid email or password', 401, 'AUTH_INVALID_CREDENTIALS');
}

function ensureUserCanAuthenticate(user: User) {
  if (user.status === 'BLOCKED' || user.status === 'INACTIVE') {
    throw new AppError('Account is not active', 403, 'AUTH_ACCOUNT_NOT_ACTIVE');
  }
}

function hashOtpCode(phone: string, purpose: string, code: string) {
  return hashToken(`${phone}:${purpose}:${code}`);
}

function toSafeUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}
