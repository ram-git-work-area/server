import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GatewayService } from '../services/gateway.service';

export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  async forward(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { service: string; '*': string };
    const result = this.gatewayService.resolveRoute(params.service, params['*'] ?? '');
    return reply.code(501).send(result);
  }
}
