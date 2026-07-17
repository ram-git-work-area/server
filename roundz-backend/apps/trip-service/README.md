# Trip Service (Phase 1: Foundation · Phase 2: Rider Matching Engine)

The Trip Service owns the trip lifecycle for the Roundz platform.

- **Phase 1 (Foundation)** implements the trip data model, a strict lifecycle state machine,
  customer + internal APIs, timeline auditing, Redis caching, and the trip Kafka event stream.
- **Phase 2 (Rider Matching Engine)** implements the event-driven, horizontally scalable engine that
  assigns the best available rider to a newly created trip — see
  [Rider Matching Engine](#rider-matching-engine-phase-2).

It intentionally does **not** implement OTP verification, trip start/end, fare calculation, wallet,
notifications, or payment processing — those arrive in later phases and will consume the events,
sessions, and internal endpoints defined here.

- **Port:** `3004`
- **Gateway prefix:** `/api/trips` → forwarded to `/trips`
- **Package:** `@roundz/trip-service`
- **Stores:** PostgreSQL (Prisma) + Redis; Kafka for async events
- **Depends on (via ports/adapters, never direct DB access):** Location Service (nearby riders),
  Rider Service (eligibility)

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

| Topic                 | Emitted when                               |
| --------------------- | ------------------------------------------ |
| `trip.created`        | A trip is created                          |
| `trip.search.started` | Matching begins (status `SEARCHING_RIDER`) |
| `trip.status.changed` | Any status transition                      |
| `trip.cancelled`      | A trip is cancelled                        |

The matching engine adds `trip.search.expanded`, `trip.rider.notified`, `trip.rider.accepted`,
`trip.rider.rejected`, `trip.rider.assigned`, and `trip.search.failed` — see
[Rider Matching Engine](#rider-matching-engine-phase-2). Consumed by the Notification Service,
Wallet Service, and Analytics.

## Rider Matching Engine (Phase 2)

The matching engine assigns the best available rider to a newly created trip. It is **event-driven**,
**horizontally scalable** (multiple stateless workers), and built for 100k+ online riders and
millions of trips by keeping database reads minimal and leaning heavily on Redis.

### Architecture & flow

```
customer creates trip
        │  trip.created
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Matching Engine (any worker; guarded by a Redis lock per trip)         │
│                                                                        │
│  start ─► create MatchingSession ─► trip → SEARCHING_RIDER             │
│    │       (trip.search.started)                                       │
│    ▼                                                                   │
│  find nearby riders (Location Service) ─► filter eligibility           │
│    │       (Rider Service + Redis availability cache)                  │
│    ▼                                                                   │
│  rank (MatchingStrategy) ─► reserve + dispatch batch                   │
│    │       (trip.rider.notified × N, wait dispatch timeout)            │
│    ▼                                                                   │
│  rider accepts ─► bind rider ─► trip → RIDER_ASSIGNED → RIDER_ARRIVING │
│            (trip.rider.accepted, trip.rider.assigned)                  │
│                                                                        │
│  nobody accepts ─► release batch ─► next batch / expand radius         │
│            (trip.search.expanded) … until assigned / max radius /      │
│            session timeout ─► trip → FAILED (trip.search.failed)       │
└──────────────────────────────────────────────────────────────────────┘
```

The engine is invoked by the `trip.created` consumer (normal path) or the internal
`POST /internal/trips/:id/match` API (manual/operational). Every public operation
(`startMatching`, `submitRiderDecision`, `handleDispatchTimeout`, `cancelMatching`) runs inside a
per-trip distributed lock, so only one worker mutates a given trip at a time.

Code layout:

- `domain/matching/matching-strategy.ts`, `strategies.ts` — pluggable ranking policies + registry.
- `domain/matching/eligibility.ts` — pure eligibility gate.
- `clients/location.client.ts`, `clients/rider.client.ts` — HTTP + in-memory adapters (ports).
- `services/matching/matching-engine.service.ts` — the orchestrator.
- `services/matching/dispatch.store.ts`, `rider-availability.cache.ts` — Redis state.
- `services/matching/dispatch-scheduler.ts` — per-batch timeout.
- `services/matching/trip-gateway.ts` — reuses the Phase 1 repository/state machine for transitions.
- `repositories/matching-session.repository.ts` — durable session progress.
- `events/matching.consumers.ts` — inbound Kafka handlers.

### Matching strategy (pluggable)

`MatchingStrategy` is an interface (`rank(candidates, context)`), resolved from a registry by the
`MATCHING_STRATEGY` config. Adding a new algorithm means implementing the interface and registering
it — **no engine, dispatch, or transport code changes**. Shipped strategies:

| Strategy        | Selects                                          |
| --------------- | ------------------------------------------------ |
| `nearest`       | Closest rider first (default)                    |
| `highest_rated` | Best rating, distance as tie-break               |
| `least_busy`    | Fewest active trips, distance as tie-break       |
| `hybrid`        | Weighted score across distance, rating, and load |

Ranking is pure and deterministic (ties broken by rider id) so batches are stable across workers.

### Eligibility rules

A rider is dispatched to only if **all** hold: `status = ACTIVE`, `approvalStatus = APPROVED`,
`onlineStatus = ONLINE`, not `BUSY`, has a primary vehicle, the vehicle matches the requested type,
a current location is available, and there is no active trip. See `domain/matching/eligibility.ts`.

### Nearby search (Location Service only)

The engine **never queries MongoDB**. It calls the Location Service through `LocationClient`
(`GET /internal/riders/nearby`), which owns the geospatial index and Redis presence. Search radius is
configurable (`MATCHING_SEARCH_RADII_METERS`, default `2000,5000,10000`) and **expands automatically**
when a radius yields no eligible, un-contacted rider, emitting `trip.search.expanded`.

### Dispatch process

Riders are dispatched in **batches** (`MATCHING_BATCH_SIZE`, default 5). For each batch the engine
reserves each rider (atomic Redis `SET NX`), emits `trip.rider.notified`, and waits
`MATCHING_DISPATCH_TIMEOUT_SECONDS`. If nobody accepts before the timeout, the batch is released and
the engine moves to the next batch, expanding the radius when the current one is exhausted. This
continues until a rider accepts, the maximum radius is reached, or the session TTL
(`MATCHING_SESSION_TTL_SECONDS`) elapses — in which case matching fails.

### Redis usage & distributed locks

Redis carries the hot, ephemeral state so workers stay stateless and DB reads stay low:

- **Rider availability cache** (`…:matching:availability:<riderId>`): eligibility snapshots kept fresh
  by the `rider.status.changed` / `location.updated` consumers, so most eligibility checks skip the
  Rider Service.
- **Reservations** (`…:matching:reservation:<riderId>`, `SET NX`): a rider can be offered to only one
  trip at a time. Released on reject/timeout/assignment or by TTL.
- **Bindings** (`…:matching:binding:<riderId>`, `SET NX`): a durable guard set on assignment so a
  rider can never be bound to two trips, even sequentially.
- **Offered / pending sets** (`…:matching:offered|pending:<tripId>`): prevent re-offering a rider and
  track how many offers in a batch are still outstanding.
- **Locks** (via `@roundz/redis` `RedisDistributedLock`, `SET NX PX` + compare-and-delete release):
  a per-trip lock (`…:matching:lock:trip:<tripId>`) ensures a single worker processes a trip, and a
  per-rider assignment lock (`…:matching:lock:assign:<riderId>`) serialises concurrent acceptances.

Together these deliver the two hard guarantees: **one active matching worker per trip** and **one
trip per rider**.

### Matching session

`MatchingSession` (PostgreSQL) persists durable progress: `id`, `tripId` (unique), `status`
(`SEARCHING` → `DISPATCHING` → `ASSIGNED` / `FAILED` / `EXPIRED` / `CANCELLED`), `strategy`,
`vehicleType`, pickup coordinates, `currentRadiusMeters`, `maxRadiusMeters`, `currentBatch`,
`notifiedRiderCount`, `assignedRiderId`, `failureReason`, `startedAt`, `expiresAt`, timestamps.
Indexed on `status`, `{ status, expiresAt }` (recovery sweeps), and `assignedRiderId`.

### Kafka events

Consumes: `trip.created` (start), `trip.cancelled` (stop), `rider.status.changed` and
`location.updated` (refresh the availability cache). Publishes: `trip.search.started`,
`trip.search.expanded`, `trip.rider.notified`, `trip.rider.accepted`, `trip.rider.rejected`,
`trip.rider.assigned`, `trip.search.failed`. Every payload carries `tripId`, `matchingSessionId`,
`requestId`, and `traceId`.

> Rider accept/reject decisions enter the engine through `submitRiderDecision` (the seam the
> rider-facing service will drive in a later phase); the engine publishes the authoritative
> `trip.rider.accepted` / `trip.rider.rejected` events. This keeps the consumer set purely inbound and
> avoids a publish→consume loop.

### Internal APIs

| Method & path                      | Roles                               | Purpose                         |
| ---------------------------------- | ----------------------------------- | ------------------------------- |
| `POST /internal/trips/:id/match`   | `ADMIN` / `SUPPORT` / service token | Start matching manually (`202`) |
| `GET /internal/trips/:id/matching` | `ADMIN` / `SUPPORT` / service token | Current matching session status |

### Scaling strategy

- Stateless workers coordinate purely through Redis + Kafka, so matching scales horizontally by adding
  instances (partitioned by Kafka consumer group).
- Per-trip locks make concurrent delivery of the same event idempotent; per-rider reservations and
  bindings prevent double-dispatch/double-assignment across workers.
- The hot path avoids the database: nearby search hits the Location Service, eligibility hits the Redis
  availability cache first, and only cache misses fall back to the Rider Service.
- The per-batch timeout uses a process-local timer, but the authoritative deadline lives on the
  session (`expiresAt`) and reservations carry TTLs, so a dedicated sweeper (indexed by
  `{ status, expiresAt }`) can recover timeouts if a worker dies — a natural next hardening step.

### Future matching strategies

Implement `MatchingStrategy` and register it in `createStrategyRegistry()`; select it with
`MATCHING_STRATEGY`. Because ranking is isolated from eligibility, dispatch, locking, and persistence,
new algorithms (surge-aware, ML-scored, SLA-weighted, …) plug in without touching existing business
logic.

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

| Variable                                       | Default           | Description                                           |
| ---------------------------------------------- | ----------------- | ----------------------------------------------------- |
| `PORT`                                         | `3004`            | HTTP port                                             |
| `DATABASE_URL` / `REDIS_URL` / `KAFKA_BROKERS` | shared            | Infra connections                                     |
| `LOCATION_SERVICE_URL` / `RIDER_SERVICE_URL`   | shared            | Matching dependencies (HTTP clients)                  |
| `JWT_SECRET`                                   | shared            | Access-token verification                             |
| `TRIP_CACHE_TTL_SECONDS`                       | `120`             | Trip/active-trip cache TTL                            |
| `MATCHING_STRATEGY`                            | `nearest`         | `nearest` / `highest_rated` / `least_busy` / `hybrid` |
| `MATCHING_SEARCH_RADII_METERS`                 | `2000,5000,10000` | Auto-expanding search radii                           |
| `MATCHING_BATCH_SIZE`                          | `5`               | Riders notified per batch                             |
| `MATCHING_DISPATCH_TIMEOUT_SECONDS`            | `15`              | Wait per batch before advancing                       |
| `MATCHING_SESSION_TTL_SECONDS`                 | `180`             | Overall matching deadline                             |
| `MATCHING_LOCK_TTL_SECONDS`                    | `30`              | Distributed lock TTL                                  |
| `MATCHING_RIDER_AVAILABILITY_TTL_SECONDS`      | `30`              | Availability cache TTL                                |
| `MATCHING_MAX_CANDIDATES_PER_RADIUS`           | `50`              | Cap on candidates fetched per radius                  |
| `ENABLE_EXTERNAL_CONNECTIONS`                  | `false`           | Toggles real DB/Redis/Kafka wiring + consumers        |

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

Matching (Phase 2), under `tests/matching/`:

- `eligibility.test.ts` — every eligibility rule and rejection reason.
- `strategies.test.ts` — nearest/highest-rated/least-busy/hybrid ranking, purity, registry.
- `matching-engine.test.ts` — dispatch, nearest-first batching, radius expansion, failure,
  accept/reject/timeout, single-active-worker lock, and no-double-assignment.
- `distributed-lock.test.ts` — acquire/release, fencing token, TTL expiry, `withLock` semantics.
- `matching.consumers.test.ts` — `trip.created` / `trip.cancelled` / `rider.status.changed` /
  `location.updated` handling and malformed-payload resilience.
- `matching.routes.integration.test.ts` — internal-caller guard and the matching HTTP surface.

## Performance & next phases

Designed for millions of trips and 100k+ online riders: indexed lookups, cursor pagination, cached
hot reads, Redis-coordinated stateless workers, batched async dispatch, and minimal database reads on
the matching hot path. Later phases add OTP verification, trip start/end, fare calculation, live
tracking, wallet, and notifications — all buildable on the state machine, matching sessions, internal
endpoints, and event stream established here.
