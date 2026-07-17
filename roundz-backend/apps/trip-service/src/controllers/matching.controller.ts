import type { FastifyReply, FastifyRequest } from 'fastify';
import { validate } from '@roundz/validation';
import { idParamsSchema } from '../schemas/trip.schemas';
import type { MatchingService } from '../services/matching/matching.service';

export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  async startMatching(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    return this.run(request, reply, 'start_matching', params.id, async () => {
      const response = await this.matchingService.startMatching(params.id, toContext(request));
      reply.code(202);
      return response;
    });
  }

  async getMatching(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    return this.run(request, reply, 'get_matching', params.id, () =>
      this.matchingService.getMatching(params.id),
    );
  }

  private async run<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    operation: string,
    tripId: string,
    handler: () => Promise<T>,
  ) {
    const startedAt = process.hrtime.bigint();
    try {
      const result = await handler();
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      request.log.info(
        {
          requestId: request.id,
          traceId: request.headers['x-trace-id'] ?? request.id,
          operation,
          tripId,
          latencyMs,
        },
        'matching operation completed',
      );
      return reply.send(result);
    } catch (error) {
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      request.log.error(
        {
          err: error,
          requestId: request.id,
          traceId: request.headers['x-trace-id'] ?? request.id,
          operation,
          tripId,
          latencyMs,
        },
        'matching operation failed',
      );
      throw error;
    }
  }
}

function toContext(request: FastifyRequest) {
  return {
    requestId: request.id,
    traceId: (request.headers['x-trace-id'] as string | undefined) ?? request.id,
  };
}
