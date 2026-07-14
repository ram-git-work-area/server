import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { AppError } from '@roundz/errors';
import { extractBearerToken, verifyAccessToken } from '@roundz/auth';
import type { RouteRegistry } from '../config/route-registry';

export type AuthenticationMiddlewareOptions = {
  jwtSecret: string;
  routeRegistry: RouteRegistry;
};

export class AuthenticationMiddleware {
  static async register(app: FastifyInstance, options: AuthenticationMiddlewareOptions) {
    if (!app.hasRequestDecorator('authUser')) {
      app.decorateRequest('authUser', null);
    }

    app.addHook('preHandler', async (request) => {
      if (!request.url.startsWith('/api/')) {
        return;
      }

      if (options.routeRegistry.isPublic(request.method, request.url)) {
        return;
      }

      try {
        request.authUser = verifyAccessToken(extractBearerToken(request), options.jwtSecret);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }

        throw new AppError('Invalid access token', 401, 'AUTH_TOKEN_INVALID');
      }
    });
  }

  static plugin(options: AuthenticationMiddlewareOptions): FastifyPluginAsync {
    return async (app) => {
      await AuthenticationMiddleware.register(app, options);
    };
  }
}
