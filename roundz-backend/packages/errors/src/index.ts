import type { FastifyError, FastifyInstance } from 'fastify';

export type ErrorDetails = Record<string, unknown> | Array<Record<string, unknown>>;

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: ErrorDetails;
  public readonly isOperational = true;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR', details?: ErrorDetails) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export type ErrorResponse = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: ErrorDetails;
  };
};

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    const appError = error instanceof AppError ? error : undefined;
    const statusCode = appError?.statusCode ?? error.statusCode ?? 500;
    const code = appError?.code ?? (statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR');
    const message = statusCode >= 500 ? 'Internal server error' : error.message;
    const details = appError?.details;

    request.log.error(
      {
        err: error,
        requestId: request.id,
        code,
        statusCode,
      },
      'request failed',
    );

    const body: ErrorResponse = {
      error: {
        code,
        message,
        requestId: request.id,
        ...(details ? { details } : {}),
      },
    };

    reply.status(statusCode).send(body);
  });
}
