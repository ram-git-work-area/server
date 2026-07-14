import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '@roundz/errors';

export class ErrorHandler {
  static register(app: FastifyInstance) {
    app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
      const appError = error instanceof AppError ? error : undefined;
      const statusCode = appError?.statusCode ?? error.statusCode ?? 500;
      const code = appError?.code ?? (statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR');
      const message = statusCode >= 500 && !appError ? 'Internal server error' : error.message;

      request.log.error(
        {
          err: error,
          requestId: request.id,
          traceId: request.traceId,
          code,
          statusCode,
        },
        'gateway error response',
      );

      reply.status(statusCode).send({
        error: {
          code,
          message,
          requestId: request.id,
          traceId: request.traceId ?? request.id,
        },
      });
    });
  }
}
