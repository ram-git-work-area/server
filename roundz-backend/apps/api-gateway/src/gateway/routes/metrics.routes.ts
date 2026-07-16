import type { FastifyInstance } from 'fastify';
import type { GatewayMetrics } from '../utils/metrics';

export async function metricsRoutes(
  app: FastifyInstance,
  options: {
    metrics: GatewayMetrics;
  },
) {
  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', options.metrics.registry.contentType);
    return reply.send(await options.metrics.registry.metrics());
  });

  app.addHook('onResponse', async (request, reply) => {
    const durationSeconds =
      Number(process.hrtime.bigint() - (request.startedAt ?? 0n)) / 1_000_000_000;
    const labels = {
      method: request.method,
      service: request.gatewayService ?? 'gateway',
      status_code: String(reply.statusCode),
    };

    options.metrics.requestCount.inc(labels);
    options.metrics.requestDuration.observe(labels, durationSeconds);
  });
}
