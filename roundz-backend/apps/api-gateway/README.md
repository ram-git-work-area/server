# Roundz API Gateway

The API Gateway is the public entry point for Roundz microservices. It is Fastify-based, cloud-agnostic, and uses pooled outbound HTTP connections, JWT validation, Redis-backed rate limiting, circuit breakers, retries, security headers, compression, service health checks, and Prometheus metrics.

## Route forwarding

Downstream service URLs are read only from environment variables.

| Gateway path           | Downstream env var         | Forwarded path example                         |
| ---------------------- | -------------------------- | ---------------------------------------------- |
| `/api/auth/*`          | `AUTH_SERVICE_URL`         | `/api/auth/login` -> `/auth/login`             |
| `/api/users/*`         | `USER_SERVICE_URL`         | `/api/users/profile` -> `/users/profile`       |
| `/api/riders/*`        | `RIDER_SERVICE_URL`        | `/api/riders/profile` -> `/riders/profile`     |
| `/api/trips/*`         | `TRIP_SERVICE_URL`         | `/api/trips/active` -> `/trips/active`         |
| `/api/location/*`      | `LOCATION_SERVICE_URL`     | `/api/location/current` -> `/location/current` |
| `/api/wallet/*`        | `WALLET_SERVICE_URL`       | `/api/wallet/balance` -> `/wallet/balance`     |
| `/api/notifications/*` | `NOTIFICATION_SERVICE_URL` | `/api/notifications` -> `/notifications`       |
| `/api/admin/*`         | `ADMIN_SERVICE_URL`        | `/api/admin/users` -> `/admin/users`           |

Example:

```bash
USER_SERVICE_URL=http://localhost:3002
AUTH_SERVICE_URL=http://localhost:3001
```

`GET http://localhost:3000/api/users/profile` forwards to `GET http://localhost:3002/users/profile`.

## Adding a new service

1. Add a new service URL environment variable to `packages/config`.
2. Add a single route entry to `src/gateway/config/route-registry.ts`.
3. Add the service to deployment configuration and health expectations.

No proxy logic should be duplicated for new services.

## Authentication flow

- Public Auth Service endpoints such as `/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`, OTP, forgot-password, and verify-email are forwarded without access-token validation.
- All other `/api/*` routes require a JWT access token.
- The gateway validates JWTs using `JWT_SECRET`.
- Authenticated requests forward:
  - `authorization`
  - `x-user-id`
  - `x-user-role`
  - `x-role`
  - `x-request-id`
  - `x-trace-id`
  - `x-forwarded-for`
  - `x-real-ip`

## Gateway flow

1. Correlation middleware ensures request/trace IDs.
2. Request logger records request start.
3. Security plugins apply Helmet, CORS, compression, and request-size limits.
4. Authentication validates JWTs for protected routes.
5. Rate limiter checks per-IP, per-user, and per-endpoint quotas.
6. Route registry resolves the downstream service.
7. Proxy service forwards using an Undici connection pool.
8. Metrics and structured logs are emitted on response.

## Error flow

- Missing route: `404 GATEWAY_ROUTE_NOT_FOUND`
- Missing downstream URL: `503 GATEWAY_SERVICE_UNCONFIGURED`
- Open circuit: `503 GATEWAY_CIRCUIT_OPEN`
- Upstream unavailable: `503 GATEWAY_UPSTREAM_UNAVAILABLE`
- Timeout: `504 GATEWAY_TIMEOUT`
- Invalid/missing JWT: `401`
- Rate limited: `429 GATEWAY_RATE_LIMITED`

All errors include `requestId` and `traceId`.

## Circuit breaker flow

Each downstream service has an independent provider-agnostic circuit breaker.

1. Failures are counted per service.
2. When `GATEWAY_CIRCUIT_FAILURE_THRESHOLD` is reached, the circuit opens.
3. Open circuits immediately return `503` without calling the downstream service.
4. After `GATEWAY_CIRCUIT_OPEN_MS`, the circuit moves to half-open.
5. A successful half-open request closes the circuit; a failed one opens it again.

## Retry flow

- Only `GET` requests are retried.
- Mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) are never retried.
- Retry count is controlled by `GATEWAY_GET_RETRY_ATTEMPTS`.

## Health and metrics

| Endpoint               | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `GET /health`          | Gateway liveness                                                       |
| `GET /health/ready`    | Gateway readiness                                                      |
| `GET /health/services` | Connectivity and circuit state for every registered downstream service |
| `GET /metrics`         | Prometheus metrics                                                     |
| `GET /docs`            | Gateway API docs                                                       |

## Environment variables

| Variable                            | Purpose                                        |
| ----------------------------------- | ---------------------------------------------- |
| `JWT_SECRET`                        | JWT validation secret                          |
| `AUTH_SERVICE_URL`                  | Auth Service base URL                          |
| `USER_SERVICE_URL`                  | User Service base URL                          |
| `RIDER_SERVICE_URL`                 | Rider Service base URL                         |
| `TRIP_SERVICE_URL`                  | Trip Service base URL                          |
| `LOCATION_SERVICE_URL`              | Location Service base URL                      |
| `WALLET_SERVICE_URL`                | Wallet Service base URL                        |
| `NOTIFICATION_SERVICE_URL`          | Notification Service base URL                  |
| `ADMIN_SERVICE_URL`                 | Admin Service base URL                         |
| `REDIS_URL`                         | Redis connection for distributed rate limiting |
| `GATEWAY_REQUEST_TIMEOUT_MS`        | Upstream request timeout                       |
| `GATEWAY_BODY_LIMIT_BYTES`          | Gateway request body size limit                |
| `GATEWAY_HEALTH_TIMEOUT_MS`         | Downstream health-check timeout                |
| `GATEWAY_GET_RETRY_ATTEMPTS`        | GET retry count                                |
| `GATEWAY_CIRCUIT_FAILURE_THRESHOLD` | Failure count before opening circuit           |
| `GATEWAY_CIRCUIT_OPEN_MS`           | Open circuit duration                          |
| `GATEWAY_RATE_LIMIT_IP_MAX`         | Per-IP quota per window                        |
| `GATEWAY_RATE_LIMIT_USER_MAX`       | Per-user quota per window                      |
| `GATEWAY_RATE_LIMIT_ENDPOINT_MAX`   | Per-endpoint quota per window                  |
| `GATEWAY_RATE_LIMIT_WINDOW_SECONDS` | Rate-limit window                              |

## Cloud readiness

The gateway does not know AWS, GCP, Azure, or any specific cloud provider. It only depends on environment variables and network-reachable service URLs.
