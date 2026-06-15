import type { FastifyInstance } from 'fastify';
import { GatewayController } from '../controllers/gateway.controller';
import { GatewayService } from '../services/gateway.service';

export async function gatewayRoutes(app: FastifyInstance) {
  const controller = new GatewayController(new GatewayService());

  app.all('/api/:service/*', (request, reply) => controller.forward(request, reply));
}
