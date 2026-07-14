import type { FastifyPluginAsync } from 'fastify';

export class CorrelationMiddleware {
  static plugin(): FastifyPluginAsync {
    return async (app) => {
      app.addHook('onRequest', async (request, reply) => {
        const traceId = (request.headers['x-trace-id'] as string | undefined) ?? request.id;

        request.traceId = traceId;
        reply.header('x-request-id', request.id);
        reply.header('x-trace-id', traceId);
      });
    };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    traceId?: string;
  }
}
