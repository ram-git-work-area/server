import type { FastifyReply, FastifyRequest } from 'fastify';
import { assertRole, extractBearerToken, verifyAccessToken, type AuthRole } from '@roundz/auth';
import { AppError } from '@roundz/errors';

export function authenticate(jwtSecret: string) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      const token = extractBearerToken(request);
      request.authUser = verifyAccessToken(token, jwtSecret);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('Invalid access token', 401, 'AUTH_TOKEN_INVALID');
    }
  };
}

export function requireRoles(allowedRoles: readonly AuthRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    assertRole(request.authUser, allowedRoles);
  };
}
