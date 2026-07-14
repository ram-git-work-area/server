import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

export class RequestLogger {
  static async register(app: FastifyInstance) {
    app.addHook('onRequest', async (request) => {
      request.startedAt = process.hrtime.bigint();
      request.log.info(
        {
          requestId: request.id,
          traceId: request.traceId,
          method: request.method,
          url: request.url,
          ip: request.ip,
        },
        'gateway request started',
      );
    });

    app.addHook('onResponse', async (request, reply) => {
      const durationMs = Number(process.hrtime.bigint() - (request.startedAt ?? 0n)) / 1_000_000;

      request.log.info(
        {
          requestId: request.id,
          traceId: request.traceId,
          method: request.method,
          url: request.url,
          service: request.gatewayService,
          statusCode: reply.statusCode,
          durationMs,
        },
        'gateway request completed',
      );
    });

    app.addHook('onError', async (request, _reply, error) => {
      request.log.error(
        {
          err: error,
          requestId: request.id,
          traceId: request.traceId,
          method: request.method,
          url: request.url,
          service: request.gatewayService,
        },
        'gateway request failed',
      );
    });
  }

  static plugin(): FastifyPluginAsync {
    return async (app) => {
      await RequestLogger.register(app);
    };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    startedAt?: bigint;
  }
}
