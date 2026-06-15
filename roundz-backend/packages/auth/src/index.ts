import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { AppError } from '@roundz/errors';

export type AuthTokenPayload = {
  sub: string;
  role: string;
  service?: string;
};

export class JwtTokenService {
  constructor(
    private readonly secret: string,
    private readonly expiresIn: string = '15m',
  ) {}

  sign(payload: AuthTokenPayload) {
    return jwt.sign(payload, this.secret, { expiresIn: this.expiresIn });
  }

  verify(token: string) {
    return jwt.verify(token, this.secret) as AuthTokenPayload;
  }
}

export function extractBearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    throw new AppError('Missing bearer token', 401, 'AUTH_TOKEN_MISSING');
  }

  return authorization.slice('Bearer '.length);
}

export const jwtAuthPlugin =
  (secret: string): FastifyPluginAsync =>
  async (app) => {
    const tokenService = new JwtTokenService(secret);

    app.decorateRequest('authUser', null);

    app.addHook('preHandler', async (request) => {
      const token = extractBearerToken(request);
      request.authUser = tokenService.verify(token);
    });
  };

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthTokenPayload | null;
  }
}
