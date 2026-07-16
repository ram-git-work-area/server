# Service Template

Each service includes:

- `src/app.ts` Fastify app factory
- `src/server.ts` process entry point with graceful shutdown
- `routes/` route registration
- `controllers/` transport orchestration
- `services/` use-case logic
- `repositories/` persistence boundaries
- `schemas/` Zod schemas
- `plugins/` Fastify plugins
- `Dockerfile` service image build

Keep routes thin and avoid business logic outside services.
