# Roundz Backend Base

Roundz is an on-demand ride and delivery platform. This directory replaces the previous .NET backend direction with a Node.js, TypeScript, and Fastify monorepo designed for independently deployable services.

## Architecture

- **Apps:** Fastify microservices under `apps/*`, each with routes, controllers, services, repositories, schemas, plugins, health endpoints, config loading, logging, error handling, graceful shutdown, and a Dockerfile.
- **Packages:** Shared infrastructure and platform code under `packages/*` for config, logging, errors, validation, PostgreSQL/Prisma, MongoDB/Mongoose, Redis, Kafka, JWT auth, and cloud-provider abstractions.
- **API gateway:** Public entry point with Swagger at `/docs`, route-forwarding structure, auth middleware placeholder, and rate-limit placeholder.
- **Async events:** Kafka is the default local event backbone, hidden behind reusable producer/consumer clients and future event provider interfaces.
- **Data stores:** PostgreSQL handles transactional state, MongoDB handles append-style records such as logs, location history, notifications, and event data, and Redis supports cache, sessions, rate limits, and distributed locks.
- **Cloud portability:** Cloud-specific SDKs should live behind interfaces in `packages/cloud`. Services consume interfaces and environment variables instead of provider-specific code.

## Local setup

```bash
cd roundz-backend
cp .env.example .env
npm install
npm run docker:local
npm run prisma:generate
npm run build
npm run dev:gateway
```

Useful local endpoints:

- API gateway health: `GET http://localhost:3000/health`
- API gateway readiness: `GET http://localhost:3000/health/ready`
- Swagger UI: `GET http://localhost:3000/docs`
- Auth login placeholder: `POST http://localhost:3001/auth/login`

Example auth login payload:

```json
{
  "email": "customer@example.com",
  "password": "password123"
}
```

## Running services

Every service has the same basic scripts:

```bash
npm run dev --workspace @roundz/auth-service
npm run build --workspace @roundz/auth-service
npm run start --workspace @roundz/auth-service
```

Ports are assigned as follows:

| Service              | Port |
| -------------------- | ---- |
| api-gateway          | 3000 |
| auth-service         | 3001 |
| user-service         | 3002 |
| rider-service        | 3003 |
| trip-service         | 3004 |
| wallet-service       | 3005 |
| notification-service | 3006 |
| location-service     | 3007 |
| admin-service        | 3008 |

## Adding a new microservice

1. Copy an existing service directory under `apps/`.
2. Rename the package in `package.json` to `@roundz/<service-name>`.
3. Keep the `routes -> controllers -> services -> repositories` flow.
4. Add Zod schemas for every request body, params object, query string, and response shape that needs validation.
5. Add the service to Helm values, Docker build matrix, gateway route registry, and Kubernetes manifests.
6. Keep provider-specific integrations behind packages or adapter interfaces.

## Switching cloud provider

Application services use environment variables:

- `CLOUD_PROVIDER`
- `STORAGE_PROVIDER`
- `PAYMENT_PROVIDER`
- `PUSH_PROVIDER`

For example, switching object storage from AWS S3 to GCP Cloud Storage should only require configuration plus a concrete adapter implementation behind `ObjectStorageProvider`. Service code should not import AWS, GCP, or Azure SDKs directly.

## CI/CD

GitHub Actions templates are under `.github/workflows` at the repository root:

- `lint.yml`: ESLint and Prettier checks.
- `test.yml`: workspace test entry point.
- `build.yml`: Prisma client generation and TypeScript builds.
- `docker-build.yml`: matrix Docker image builds for all services.
- `security-scan.yml`: npm audit plus container/IaC scanner placeholder.
- `deploy.yml`: provider-neutral deployment placeholder with AWS/GCP/Azure environment variables.

## Future service implementation order

1. Auth and identity boundaries.
2. User, rider, and admin profile services.
3. Location ingestion and location history persistence.
4. Trip lifecycle and rider matching.
5. Wallet, payments, refunds, and ledger flows.
6. Notifications across push, SMS, email, and in-app records.
7. Operational analytics, fraud controls, support tooling, and regional scaling features.

## Current scope

Implemented now:

- Health and readiness endpoints in every service.
- Auth login placeholder with JWT signing and Zod validation.
- Kafka producer and consumer package plus sample trip/notification usage.
- PostgreSQL/Prisma, MongoDB/Mongoose, and Redis connection helpers.
- Object storage, secrets, push, payment, and maps provider interfaces with placeholder adapters.
- Docker Compose local dependencies, Kubernetes manifests, Helm skeleton, Terraform skeleton, and CI/CD templates.

Not implemented yet:

- Full trip booking, dispatch, payment, wallet, notification, admin, or user business workflows.
- Cloud SDK calls for provider adapters.
- Production-grade gateway proxying and rate limiting.
