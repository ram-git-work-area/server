import type { FastifyPluginAsync } from 'fastify';
import { registerErrorHandler } from '@roundz/errors';

export const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  registerErrorHandler(app);
};
