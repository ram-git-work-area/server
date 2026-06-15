import type { FastifyPluginAsync } from 'fastify';

const publicPathPrefixes = ['/health', '/docs', '/documentation'];

export const authMiddlewarePlugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (request) => {
    if (publicPathPrefixes.some((prefix) => request.url.startsWith(prefix))) {
      return;
    }

    request.log.debug('auth middleware placeholder reached');
  });
};
