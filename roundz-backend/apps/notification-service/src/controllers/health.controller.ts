import type { FastifyReply, FastifyRequest } from 'fastify';
import { validate } from '@roundz/validation';
import { healthResponseSchema } from '../schemas/health.schema';
import { HealthService } from '../services/health.service';

export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  async getHealth(_request: FastifyRequest, reply: FastifyReply) {
    const response = validate(healthResponseSchema, await this.healthService.check());
    return reply.send(response);
  }

  async getReadiness(_request: FastifyRequest, reply: FastifyReply) {
    const response = validate(healthResponseSchema, await this.healthService.ready());
    return reply.send(response);
  }
}
