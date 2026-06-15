import type { FastifyPluginAsync } from 'fastify';

export const rateLimitPlaceholderPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request) => {
    request.log.debug('rate-limit placeholder reached');
  });
};
