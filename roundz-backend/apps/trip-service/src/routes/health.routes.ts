import type { FastifyInstance } from 'fastify';
import { HealthController } from '../controllers/health.controller';
import { HealthService } from '../services/health.service';

export async function healthRoutes(app: FastifyInstance) {
  const controller = new HealthController(new HealthService());

  app.get('/', (request, reply) => controller.getHealth(request, reply));
  app.get('/ready', (request, reply) => controller.getReadiness(request, reply));
}
