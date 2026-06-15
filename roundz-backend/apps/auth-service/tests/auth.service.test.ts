import { randomUUID } from 'node:crypto';
import type {
  LoginAttempt,
  OtpCode,
  OtpPurpose,
  RefreshToken,
  User,
  UserRole,
  UserSession,
  UserStatus,
} from '@prisma/client';
import type { SignOptions } from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { assertRole, hashToken } from '@roundz/auth';
import { AppError } from '@roundz/errors';
import type {
  AuthRepositoryPort,
  CreateLoginAttemptInput,
  CreateOtpCodeInput,
  CreateRefreshTokenInput,
  CreateSessionInput,
  CreateUserInput,
  RefreshTokenWithUser,
} from '../src/repositories/auth.repository';
import { AuthService } from '../src/services/auth.service';
import { NoopAuthNotificationProvider } from '../src/services/notification.provider';
import { NoopAuthRateLimiter } from '../src/services/rate-limiter.service';

const context = {
  requestId: 'test-request',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

describe('AuthService', () => {
  it('registers a user without returning passwordHash', async () => {
    const { service, repository } = createService();

    const response = await service.register(
      {
        email: 'Customer@Example.com',
        password: 'password123',
        fullName: 'Roundz Customer',
        role: 'CUSTOMER',
      },
      context,
    );

    expect(response.user.email).toBe('customer@example.com');
    expect(response.user.role).toBe('CUSTOMER');
    expect(response.tokens.accessToken).toBeTruthy();
    expect('passwordHash' in response.user).toBe(false);
    expect(repository.users).toHaveLength(1);
  });

  it('logs in with a valid email and password', async () => {
    const { service, repository } = createService();
    await service.register(
      {
        email: 'customer@example.com',
        password: 'password123',
        fullName: 'Roundz Customer',
        role: 'CUSTOMER',
      },
      context,
    );

    const response = await service.login(
      {
        email: 'customer@example.com',
        password: 'password123',
      },
      context,
    );

    expect(response.user.email).toBe('customer@example.com');
    expect(response.tokens.refreshToken).toBeTruthy();
    expect(repository.loginAttempts.at(-1)?.success).toBe(true);
  });

  it('uses a generic error for invalid passwords', async () => {
    const { service, repository } = createService();
    await service.register(
      {
        email: 'customer@example.com',
        password: 'password123',
        fullName: 'Roundz Customer',
        role: 'CUSTOMER',
      },
      context,
    );

    await expect(
      service.login(
        {
          email: 'customer@example.com',
          password: 'wrong-password',
        },
        context,
      ),
    ).rejects.toMatchObject({
      message: 'Invalid email or password',
      code: 'AUTH_INVALID_CREDENTIALS',
    });
    expect(repository.loginAttempts.at(-1)?.failureReason).toBe('invalid_credentials');
  });

  it('refreshes tokens and revokes the previous refresh token', async () => {
    const { service, repository } = createService();
    const registration = await service.register(
      {
        email: 'customer@example.com',
        password: 'password123',
        fullName: 'Roundz Customer',
        role: 'CUSTOMER',
      },
      context,
    );

    const refreshed = await service.refresh(
      {
        refreshToken: registration.tokens.refreshToken,
      },
      context,
    );

    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.refreshToken).not.toBe(registration.tokens.refreshToken);
    expect(
      repository.refreshTokens.find(
        (token) => token.tokenHash === hashToken(registration.tokens.refreshToken),
      )?.revokedAt,
    ).toBeInstanceOf(Date);
  });
});

describe('role guard', () => {
  it('allows matching roles and blocks missing roles', () => {
    expect(() =>
      assertRole({ sub: 'admin-user', role: 'ADMIN', type: 'access' }, ['ADMIN']),
    ).not.toThrow();
    expect(() =>
      assertRole({ sub: 'customer-user', role: 'CUSTOMER', type: 'access' }, ['ADMIN']),
    ).toThrow(AppError);
  });
});

function createService() {
  const repository = new MemoryAuthRepository();
  const eventPublisher = {
    publish: vi.fn(async () => undefined),
  };
  const service = new AuthService({
    repository,
    jwtSecret: 'unit-test-secret-with-enough-length',
    accessTokenExpiresIn: '15m' as SignOptions['expiresIn'],
    refreshTokenExpiresIn: '30d' as SignOptions['expiresIn'],
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 2592000,
    loginRateLimitMax: 5,
    loginRateLimitWindowSeconds: 900,
    otpRateLimitMax: 3,
    otpRateLimitWindowSeconds: 3600,
    otpTtlSeconds: 300,
    rateLimiter: new NoopAuthRateLimiter(),
    eventPublisher,
    notificationProvider: new NoopAuthNotificationProvider(),
  });

  return { service, repository, eventPublisher };
}

class MemoryAuthRepository implements AuthRepositoryPort {
  public users: User[] = [];
  public sessions: UserSession[] = [];
  public refreshTokens: RefreshToken[] = [];
  public loginAttempts: LoginAttempt[] = [];
  public otpCodes: OtpCode[] = [];

  async createUser(input: CreateUserInput): Promise<User> {
    const now = new Date();
    const user: User = {
      id: randomUUID(),
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordHash: input.passwordHash ?? null,
      fullName: input.fullName,
      role: input.role as UserRole,
      status: input.status as UserStatus,
      emailVerified: input.emailVerified ?? false,
      phoneVerified: input.phoneVerified ?? false,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.users.push(user);
    return user;
  }

  async findUserById(id: string) {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async findUserByEmail(email: string) {
    return this.users.find((user) => user.email === email) ?? null;
  }

  async findUserByPhone(phone: string) {
    return this.users.find((user) => user.phone === phone) ?? null;
  }

  async updateLastLoginAt(userId: string, lastLoginAt: Date) {
    const user = await this.findUserById(userId);
    if (user) {
      user.lastLoginAt = lastLoginAt;
      user.updatedAt = new Date();
    }
  }

  async updatePassword(userId: string, passwordHash: string) {
    const user = await this.findUserById(userId);
    if (!user) {
      throw new Error('user not found');
    }

    user.passwordHash = passwordHash;
    user.updatedAt = new Date();
    return user;
  }

  async markPhoneVerified(userId: string) {
    const user = await this.findUserById(userId);
    if (!user) {
      throw new Error('user not found');
    }

    user.phoneVerified = true;
    user.status = 'ACTIVE';
    user.updatedAt = new Date();
    return user;
  }

  async createSession(input: CreateSessionInput): Promise<UserSession> {
    const now = new Date();
    const session: UserSession = {
      id: randomUUID(),
      userId: input.userId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.push(session);
    return session;
  }

  async revokeSession(sessionId: string, revokedAt: Date) {
    const session = this.sessions.find((item) => item.id === sessionId);
    if (session) {
      session.revokedAt = revokedAt;
      session.updatedAt = revokedAt;
    }
  }

  async revokeUserSessions(userId: string, revokedAt: Date) {
    this.sessions
      .filter((session) => session.userId === userId && !session.revokedAt)
      .forEach((session) => {
        session.revokedAt = revokedAt;
        session.updatedAt = revokedAt;
      });
  }

  async createRefreshToken(input: CreateRefreshTokenInput): Promise<RefreshToken> {
    const now = new Date();
    const refreshToken: RefreshToken = {
      id: input.id,
      tokenHash: input.tokenHash,
      userId: input.userId,
      sessionId: input.sessionId,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.refreshTokens.push(refreshToken);
    return refreshToken;
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenWithUser | null> {
    const refreshToken = this.refreshTokens.find((token) => token.tokenHash === tokenHash);

    if (!refreshToken) {
      return null;
    }

    const user = await this.findUserById(refreshToken.userId);

    if (!user) {
      return null;
    }

    return {
      ...refreshToken,
      user,
      session: this.sessions.find((session) => session.id === refreshToken.sessionId) ?? null,
    };
  }

  async revokeRefreshToken(refreshTokenId: string, revokedAt: Date) {
    const refreshToken = this.refreshTokens.find((token) => token.id === refreshTokenId);
    if (refreshToken) {
      refreshToken.revokedAt = revokedAt;
      refreshToken.updatedAt = revokedAt;
    }
  }

  async revokeUserRefreshTokens(userId: string, revokedAt: Date) {
    this.refreshTokens
      .filter((token) => token.userId === userId && !token.revokedAt)
      .forEach((token) => {
        token.revokedAt = revokedAt;
        token.updatedAt = revokedAt;
      });
  }

  async createLoginAttempt(input: CreateLoginAttemptInput): Promise<LoginAttempt> {
    const attempt: LoginAttempt = {
      id: randomUUID(),
      identifier: input.identifier,
      userId: input.userId ?? null,
      success: input.success,
      failureReason: input.failureReason ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      createdAt: new Date(),
    };

    this.loginAttempts.push(attempt);
    return attempt;
  }

  async createOtpCode(input: CreateOtpCodeInput): Promise<OtpCode> {
    const now = new Date();
    const otpCode: OtpCode = {
      id: randomUUID(),
      userId: input.userId ?? null,
      destination: input.destination,
      purpose: input.purpose as OtpPurpose,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
      consumedAt: null,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.otpCodes.push(otpCode);
    return otpCode;
  }

  async findValidOtp(input: {
    destination: string;
    purpose: OtpPurpose;
    codeHash: string;
    now: Date;
  }) {
    return (
      this.otpCodes.find(
        (otpCode) =>
          otpCode.destination === input.destination &&
          otpCode.purpose === input.purpose &&
          otpCode.codeHash === input.codeHash &&
          !otpCode.consumedAt &&
          otpCode.expiresAt > input.now,
      ) ?? null
    );
  }

  async consumeOtp(otpId: string, consumedAt: Date) {
    const otpCode = this.otpCodes.find((item) => item.id === otpId);
    if (otpCode) {
      otpCode.consumedAt = consumedAt;
      otpCode.updatedAt = consumedAt;
    }
  }
}
