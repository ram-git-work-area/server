import type { FastifyInstance, FastifyRequest } from 'fastify';
import { extractBearerToken, verifyAccessToken } from '@roundz/auth';
import { loadConfig } from '@roundz/config';
import { AppError } from '@roundz/errors';
import { MatchingController } from '../controllers/matching.controller';
import type { MatchingService } from '../services/matching/matching.service';

export type MatchingRoutesOptions = {
  service: MatchingService;
};

/**
 * Internal-only matching APIs. Guarded for privileged roles / service tokens —
 * these are operational and inter-service seams, never customer-facing.
 */
export async function matchingRoutes(app: FastifyInstance, options: MatchingRoutesOptions) {
  const config = loadConfig({ serviceName: 'trip-service', defaultPort: 3004 });
  const controller = new MatchingController(options.service);
  const jwtSecret = config.jwtSecret;

  app.decorateRequest('authUser', null);
  app.addHook('preHandler', async (request) => {
    request.authUser = verifyAccessToken(extractBearerToken(request), jwtSecret);
  });

  const internalGuard = { preHandler: assertInternalCaller };

  app.post('/internal/trips/:id/match', internalGuard, (request, reply) =>
    controller.startMatching(request, reply),
  );
  app.get('/internal/trips/:id/matching', internalGuard, (request, reply) =>
    controller.getMatching(request, reply),
  );
}

async function assertInternalCaller(request: FastifyRequest) {
  const user = request.authUser;
  const isPrivileged = user?.role === 'ADMIN' || user?.role === 'SUPPORT';
  const isService = Boolean(user?.service);

  if (!user || (!isPrivileged && !isService)) {
    throw new AppError('Internal access required', 403, 'MATCHING_INTERNAL_ONLY');
  }
}
