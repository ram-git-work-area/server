import { createHash, randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { SignOptions } from 'jsonwebtoken';
import jwt from 'jsonwebtoken';
import { AppError } from '@roundz/errors';

export const AuthRoles = ['CUSTOMER', 'RIDER', 'ADMIN', 'SUPPORT'] as const;
export type AuthRole = (typeof AuthRoles)[number];

export type AuthTokenPayload = {
  sub: string;
  role: AuthRole;
  service?: string;
  sessionId?: string;
};

export type AccessTokenPayload = AuthTokenPayload & {
  type: 'access';
};

export type RefreshTokenPayload = AuthTokenPayload & {
  type: 'refresh';
  tokenId: string;
};

export class JwtTokenService {
  constructor(
    private readonly secret: string,
    private readonly expiresIn: SignOptions['expiresIn'] = '15m',
  ) {}

  sign(payload: AuthTokenPayload) {
    return signAccessToken(payload, this.secret, this.expiresIn);
  }

  verify(token: string) {
    return verifyAccessToken(token, this.secret);
  }
}

export function signAccessToken(
  payload: AuthTokenPayload,
  secret: string,
  expiresIn: SignOptions['expiresIn'] = '15m',
) {
  return jwt.sign({ ...payload, type: 'access' satisfies AccessTokenPayload['type'] }, secret, {
    expiresIn,
  });
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  const payload = jwt.verify(token, secret) as AccessTokenPayload;

  if (payload.type !== 'access') {
    throw new AppError('Invalid access token', 401, 'AUTH_TOKEN_INVALID');
  }

  return payload;
}

export function signRefreshToken(
  payload: Omit<RefreshTokenPayload, 'type'>,
  secret: string,
  expiresIn: SignOptions['expiresIn'] = '30d',
) {
  return jwt.sign({ ...payload, type: 'refresh' satisfies RefreshTokenPayload['type'] }, secret, {
    expiresIn,
  });
}

export function verifyRefreshToken(token: string, secret: string): RefreshTokenPayload {
  const payload = jwt.verify(token, secret) as RefreshTokenPayload;

  if (payload.type !== 'refresh') {
    throw new AppError('Invalid refresh token', 401, 'AUTH_REFRESH_TOKEN_INVALID');
  }

  return payload;
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function generateSecureToken(bytes = 64) {
  return randomBytes(bytes).toString('base64url');
}

export function extractBearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    throw new AppError('Missing bearer token', 401, 'AUTH_TOKEN_MISSING');
  }

  return authorization.slice('Bearer '.length);
}

export function assertRole(
  payload: AuthTokenPayload | null | undefined,
  allowedRoles: readonly AuthRole[],
) {
  if (!payload) {
    throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  }

  if (!allowedRoles.includes(payload.role)) {
    throw new AppError('Forbidden', 403, 'AUTH_FORBIDDEN');
  }
}

export function roleGuard(allowedRoles: readonly AuthRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    assertRole(request.authUser, allowedRoles);
  };
}

export const jwtAuthPlugin =
  (secret: string): FastifyPluginAsync =>
  async (app) => {
    app.decorateRequest('authUser', null);

    app.addHook('preHandler', async (request) => {
      const token = extractBearerToken(request);
      request.authUser = verifyAccessToken(token, secret);
    });
  };

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AccessTokenPayload | null;
  }
}
