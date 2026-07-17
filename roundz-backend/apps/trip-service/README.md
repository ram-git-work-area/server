# Trip Service (Phase 1: Foundation)

The Trip Service owns the trip lifecycle for the Roundz platform. This first phase implements the
**foundation**: the trip data model, a strict lifecycle state machine, customer + internal APIs,
timeline auditing, Redis caching, and the trip Kafka event stream.

It intentionally does **not** implement rider matching, OTP verification, fare calculation, wallet,
notifications, live tracking, or payment processing — those arrive in later phases and will consume
the events and internal endpoint defined here.

- **Port:** `3004`
- **Gateway prefix:** `/api/trips` → forwarded to `/trips`
- **Package:** `@roundz/trip-service`
- **Stores:** PostgreSQL (Prisma) + Redis

## Architecture

Clean Architecture with dependency injection, matching the other Roundz services:

```
routes -> controller -> service -> repository -> PostgreSQL
                             \-> cache (Redis) / events (Kafka) / state machine
```

- **Routes** (`routes/trip.routes.ts`): dependency wiring, JWT `preHandler`, per-route role guards,
  and the internal-caller guard for the status endpoint.
- **Controller** (`controllers/trip.controller.ts`): thin — Zod validation, identity resolution,
  structured logging with latency. No business logic.
- **Service** (`services/trip.service.ts`): all business rules (active-trip enforcement, coordinate
  validation, trip-number generation, state transitions, cache management, event publishing).
- **Repository** (`repositories/trip.repository.ts`): the only layer touching Prisma;
  `TripRepositoryPort` + `TripRepository`, with an in-memory implementation for tests. Trip creation
  and every status change are transactional and always write a `TripTimeline` row.
- **State machine** (`domain/trip-state-machine.ts`): a pure, isolated module so new states/edges
  can be added later without touching transport or persistence code.
- **Cache** (`services/trip-cache.service.ts`) and **events** (`events/trip-events.publisher.ts`)
  with Noop/Memory/Redis and Noop/Kafka variants respectively.

`customerId` is always resolved from the JWT subject and never trusted from the request body.

## Database schema

### `Trip`

`id`, `tripNumber` (unique), `customerId`, `riderId` (nullable), `vehicleType`, `tripType`,
`status`, pickup/drop coordinates + addresses, `estimatedDistance`, `estimatedDuration`,
`estimatedFare`, `actualFare` (nullable), `paymentMethod`, `cancellationReason` (nullable),
`cancelledBy` (nullable), `createdAt`, `updatedAt`.

Indexes: `{ customerId, status }` (active-trip lookup), `{ customerId, createdAt }` (listing),
`riderId`, `status`, `createdAt`.

> `customerId`/`riderId` are stored as plain identifiers without cross-service foreign keys to keep
> the Trip domain decoupled from the User/Rider services.

### `TripTimeline`

`id`, `tripId` (FK → `Trip`, cascade delete), `status`, `description`, `createdAt`. Every state
transition (including creation) appends one row, giving a full immutable audit trail.

## Trip lifecycle

```
                 ┌───────────────► CANCELLED ◄───────────────┐
                 │                                            │
REQUESTED ─► SEARCHING_RIDER ─► RIDER_ASSIGNED ─► RIDER_ARRIVING ─► OTP_PENDING ─► IN_PROGRESS ─► COMPLETED
     │              │                  │                │              │               │
     └──────────────┴──────────────────┴────────────────┴──────────────┴───────────────┴─► FAILED
```

Every active state can also transition to `CANCELLED` or `FAILED`. `COMPLETED`, `CANCELLED`, and
`FAILED` are terminal.

### State machine

- Transitions are validated strictly; invalid or same-state transitions are rejected with
  `409 TRIP_INVALID_TRANSITION`.
- Active statuses: everything except the three terminal states.
- Customer-cancellable statuses: `REQUESTED`, `SEARCHING_RIDER`, `RIDER_ASSIGNED`,
  `RIDER_ARRIVING`, `OTP_PENDING` (rejected with `409 TRIP_NOT_CANCELLABLE` once `IN_PROGRESS`).

## API

All endpoints require a JWT and use the shared `{ "data": ... }` envelope.

| Method & path             | Roles                                    | Purpose                                                   |
| ------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `POST /trips`             | `CUSTOMER`                               | Create a trip (status `REQUESTED`; no rider assigned yet) |
| `GET /trips/:id`          | `CUSTOMER` (owner) / `ADMIN` / `SUPPORT` | Trip details                                              |
| `GET /trips`              | `CUSTOMER`                               | List own trips (cursor pagination, status/date filters)   |
| `PATCH /trips/:id/cancel` | `CUSTOMER` (owner)                       | Customer cancellation                                     |
| `PATCH /trips/:id/status` | `ADMIN` / `SUPPORT` / service token      | Internal state transition (future services)               |

### `POST /trips`

```json
{
  "vehicleType": "BIKE",
  "tripType": "RIDE",
  "pickupLatitude": 12.9716,
  "pickupLongitude": 77.5946,
  "pickupAddress": "MG Road, Bengaluru",
  "dropLatitude": 12.9352,
  "dropLongitude": 77.6245,
  "dropAddress": "Koramangala, Bengaluru",
  "estimatedDistance": 6500,
  "estimatedDuration": 1200,
  "estimatedFare": 145.5,
  "paymentMethod": "CASH"
}
```

Response `201`:

```json
{
  "data": {
    "id": "...",
    "tripNumber": "TRP-20260717-AB12CD34",
    "status": "REQUESTED",
    "customerId": "...",
    "riderId": null
  }
}
```

### `GET /trips`

`?limit=20&cursor=<uuid>&status=REQUESTED&from=<iso>&to=<iso>`

### `PATCH /trips/:id/cancel`

```json
{ "reason": "changed my mind" }
```

### `PATCH /trips/:id/status` (internal)

```json
{ "status": "SEARCHING_RIDER", "description": "matching started", "riderId": "<uuid>" }
```

## Kafka events

Defined centrally in `packages/kafka/src/topics.ts`. Each payload carries `tripId`, `customerId`,
`requestId`, and `traceId`.

| Topic                 | Emitted when                            |
| --------------------- | --------------------------------------- |
| `trip.created`        | A trip is created                       |
| `trip.search.started` | Status transitions to `SEARCHING_RIDER` |
| `trip.status.changed` | Any status transition                   |
| `trip.cancelled`      | A trip is cancelled                     |

Consumed later by the Matching Engine, Notification Service, Wallet Service, and Analytics.

## Redis caching

- **Trip details** (`trip-service:trip:<tripId>`): populated on create/read/update, invalidated by
  being overwritten on each status change.
- **Customer active trip** (`trip-service:active:<customerId>`): set on create and refreshed on
  non-terminal transitions; deleted when the trip reaches a terminal state. Used to enforce the
  single-active-trip rule quickly.

TTL is controlled by `TRIP_CACHE_TTL_SECONDS`. Redis is an accelerator; correctness falls back to
PostgreSQL, so the service runs with a Noop cache when Redis is unavailable.

## Business rules

- A customer may have only one active trip; creation is rejected with `409 TRIP_ACTIVE_EXISTS`.
- Pickup and drop coordinates are validated; identical pickup/drop is rejected
  (`400 TRIP_IDENTICAL_LOCATIONS`).
- `tripNumber` is unique (generated with retry on the rare collision).

## Environment variables

| Variable                                       | Default | Description                        |
| ---------------------------------------------- | ------- | ---------------------------------- |
| `PORT`                                         | `3004`  | HTTP port                          |
| `DATABASE_URL` / `REDIS_URL` / `KAFKA_BROKERS` | shared  | Infra connections                  |
| `JWT_SECRET`                                   | shared  | Access-token verification          |
| `TRIP_CACHE_TTL_SECONDS`                       | `120`   | Trip/active-trip cache TTL         |
| `ENABLE_EXTERNAL_CONNECTIONS`                  | `false` | Toggles real DB/Redis/Kafka wiring |

## Testing

```bash
npm run test --workspace @roundz/trip-service
```

- `tests/trip-state-machine.test.ts` — valid/invalid transitions, terminal states.
- `tests/trip.repository.test.ts` — creation + timeline, unique trip number, active-trip lookup,
  status timeline, filtered listing.
- `tests/trip.service.test.ts` — creation, active-trip rule, cancellation rules, transition
  validation, ownership, event emission, pagination.
- `tests/trip.routes.integration.test.ts` — auth/role enforcement, internal-caller guard, and the
  full HTTP surface.

## Performance & next phases

Designed for millions of trips: indexed lookups, cursor pagination, cached hot reads, stateless
instances for horizontal scaling. Later phases add rider matching (consuming `trip.search.started`),
OTP verification, fare calculation, live tracking, wallet, and notifications — all buildable on the
state machine, internal status endpoint, and event stream established here.
