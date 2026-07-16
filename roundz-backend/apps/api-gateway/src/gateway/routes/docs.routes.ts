import type { FastifyInstance } from 'fastify';

const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Roundz API Gateway',
    description: 'Public API entry point for Roundz microservices.',
    version: '0.1.0',
  },
  paths: {
    '/api/auth/{path}': {
      post: {
        summary: 'Forward auth requests to Auth Service',
      },
    },
    '/api/users/{path}': {
      get: {
        summary: 'Forward user requests to User Service',
      },
    },
    '/api/riders/{path}': {
      get: {
        summary: 'Forward rider requests to Rider Service',
      },
    },
    '/api/trips/{path}': {
      get: {
        summary: 'Forward trip requests to Trip Service',
      },
    },
    '/api/location/{path}': {
      get: {
        summary: 'Forward location requests to Location Service',
      },
    },
    '/api/wallet/{path}': {
      get: {
        summary: 'Forward wallet requests to Wallet Service',
      },
    },
    '/api/notifications/{path}': {
      get: {
        summary: 'Forward notification requests to Notification Service',
      },
    },
    '/api/admin/{path}': {
      get: {
        summary: 'Forward admin requests to Admin Service',
      },
    },
    '/health': {
      get: {
        summary: 'Gateway health check',
      },
    },
    '/health/ready': {
      get: {
        summary: 'Gateway readiness check',
      },
    },
    '/health/services': {
      get: {
        summary: 'Downstream service health checks',
      },
    },
    '/metrics': {
      get: {
        summary: 'Prometheus metrics',
      },
    },
  },
};

export async function docsRoutes(app: FastifyInstance) {
  app.get('/openapi.json', async () => openApiDocument);
  app.get('/docs', async (_request, reply) => {
    reply.type('text/html');
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Roundz API Gateway Docs</title>
  </head>
  <body>
    <h1>Roundz API Gateway</h1>
    <p>Gateway OpenAPI document: <a href="/openapi.json">/openapi.json</a></p>
  </body>
</html>`;
  });
}
