import type {
  LoginAttempt,
  OtpCode,
  OtpPurpose,
  PrismaClient,
  RefreshToken,
  User,
  UserRole,
  UserSession,
  UserStatus,
} from '@prisma/client';

export type CreateUserInput = {
  email?: string;
  phone?: string;
  passwordHash?: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

export type CreateSessionInput = {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
};

export type CreateRefreshTokenInput = {
  id: string;
  tokenHash: string;
  userId: string;
  sessionId: string;
  expiresAt: Date;
};

export type CreateLoginAttemptInput = {
  identifier: string;
  userId?: string;
  success: boolean;
  failureReason?: string;
  ipAddress?: string;
  userAgent?: string;
};

export type CreateOtpCodeInput = {
  userId?: string;
  destination: string;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: Date;
};

export type RefreshTokenWithUser = RefreshToken & {
  user: User;
  session: UserSession | null;
};

export interface AuthRepositoryPort {
  createUser(input: CreateUserInput): Promise<User>;
  findUserById(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  findUserByPhone(phone: string): Promise<User | null>;
  updateLastLoginAt(userId: string, lastLoginAt: Date): Promise<void>;
  updatePassword(userId: string, passwordHash: string): Promise<User>;
  markPhoneVerified(userId: string): Promise<User>;
  createSession(input: CreateSessionInput): Promise<UserSession>;
  revokeSession(sessionId: string, revokedAt: Date): Promise<void>;
  revokeUserSessions(userId: string, revokedAt: Date): Promise<void>;
  createRefreshToken(input: CreateRefreshTokenInput): Promise<RefreshToken>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenWithUser | null>;
  revokeRefreshToken(refreshTokenId: string, revokedAt: Date): Promise<void>;
  revokeUserRefreshTokens(userId: string, revokedAt: Date): Promise<void>;
  createLoginAttempt(input: CreateLoginAttemptInput): Promise<LoginAttempt>;
  createOtpCode(input: CreateOtpCodeInput): Promise<OtpCode>;
  findValidOtp(input: {
    destination: string;
    purpose: OtpPurpose;
    codeHash: string;
    now: Date;
  }): Promise<OtpCode | null>;
  consumeOtp(otpId: string, consumedAt: Date): Promise<void>;
}

export class AuthRepository implements AuthRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async createUser(input: CreateUserInput) {
    return this.prisma.user.create({
      data: {
        email: input.email,
        phone: input.phone,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        role: input.role,
        status: input.status,
        emailVerified: input.emailVerified ?? false,
        phoneVerified: input.phoneVerified ?? false,
      },
    });
  }

  async findUserById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findUserByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  async updateLastLoginAt(userId: string, lastLoginAt: Date) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt },
    });
  }

  async updatePassword(userId: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async markPhoneVerified(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        phoneVerified: true,
        status: 'ACTIVE',
      },
    });
  }

  async createSession(input: CreateSessionInput) {
    return this.prisma.userSession.create({
      data: input,
    });
  }

  async revokeSession(sessionId: string, revokedAt: Date) {
    await this.prisma.userSession.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
      },
      data: { revokedAt },
    });
  }

  async revokeUserSessions(userId: string, revokedAt: Date) {
    await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt },
    });
  }

  async createRefreshToken(input: CreateRefreshTokenInput) {
    return this.prisma.refreshToken.create({
      data: input,
    });
  }

  async findRefreshTokenByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: true,
        session: true,
      },
    });
  }

  async revokeRefreshToken(refreshTokenId: string, revokedAt: Date) {
    await this.prisma.refreshToken.updateMany({
      where: {
        id: refreshTokenId,
        revokedAt: null,
      },
      data: { revokedAt },
    });
  }

  async revokeUserRefreshTokens(userId: string, revokedAt: Date) {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt },
    });
  }

  async createLoginAttempt(input: CreateLoginAttemptInput) {
    return this.prisma.loginAttempt.create({
      data: input,
    });
  }

  async createOtpCode(input: CreateOtpCodeInput) {
    return this.prisma.otpCode.create({
      data: input,
    });
  }

  async findValidOtp(input: {
    destination: string;
    purpose: OtpPurpose;
    codeHash: string;
    now: Date;
  }) {
    return this.prisma.otpCode.findFirst({
      where: {
        destination: input.destination,
        purpose: input.purpose,
        codeHash: input.codeHash,
        consumedAt: null,
        expiresAt: {
          gt: input.now,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async consumeOtp(otpId: string, consumedAt: Date) {
    await this.prisma.otpCode.update({
      where: { id: otpId },
      data: { consumedAt },
    });
  }
}
