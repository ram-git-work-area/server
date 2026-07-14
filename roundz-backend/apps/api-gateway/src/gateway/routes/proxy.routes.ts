import type { FastifyInstance } from 'fastify';
import type { ProxyService } from '../proxy/proxy.service';

export async function proxyRoutes(
  app: FastifyInstance,
  options: {
    proxyService: ProxyService;
  },
) {
  app.all('/api/*', async (request, reply) => options.proxyService.forward(request, reply));
}
