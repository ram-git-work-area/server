# Location Service

The Location Service is the single source of truth for rider location and presence on the Roundz
platform. It owns rider current location, online presence, GPS history, nearby-rider lookup, and
the location Kafka event stream that the Trip, Notification, Analytics, and Admin services consume
later.

It deliberately does **not** implement trip assignment, ride matching, trip lifecycle, wallet,
notifications, or admin business logic.

- **Port:** `3007`
- **Gateway prefix:** `/api/location` → forwarded to `/location`
- **Package:** `@roundz/location-service`
- **Stores:** MongoDB (high-frequency GPS data — never PostgreSQL) + Redis (presence/cache)

## Architecture

Clean Architecture with dependency injection, mirroring the other Roundz services:

```
routes -> controller -> service -> repository -> MongoDB
                              \-> cache (Redis) / events (Kafka) / history writer / presence sweeper
```

- **Routes** (`routes/location.routes.ts`): dependency wiring, JWT auth `preHandler`, per-route
  role guards, and background lifecycle (history writer + presence sweeper) start/stop.
- **Controller** (`controllers/location.controller.ts`): thin; Zod validation, identity
  resolution, structured logging with processing time. No business logic.
- **Service** (`services/location.service.ts`): all business rules (validation, stale/duplicate
  handling, presence transitions, geo lookup, history pagination, sweeps).
- **Repository** (`repositories/location.repository.ts`): the only layer touching MongoDB.
  `LocationRepositoryPort` interface + `MongoLocationRepository` implementation; an in-memory
  implementation backs the tests.
- **Cache** (`services/location-cache.service.ts`): Redis current-location cache, presence
  markers, and a distributed lock, with Noop/Memory variants.
- **History writer** (`services/history-writer.ts`): batches history `insertMany` writes.
- **Presence sweeper** (`services/presence-sweeper.ts`): periodic stale-presence sweeps.

`riderId` is always resolved from the authenticated JWT subject and never trusted from client
input. Only `ADMIN`/`SUPPORT` may read another rider's location.

## MongoDB schema

### `rider_current_locations` (`RiderCurrentLocation`)

`riderId` (unique), `location` (GeoJSON Point), `latitude`, `longitude`, `heading`, `speed`,
`accuracy`, `altitude`, `vehicleType`, `onlineStatus` (`ONLINE`/`OFFLINE`), `lastUpdatedAt`.

Indexes:

- `riderId` unique
- `location` `2dsphere` (nearby queries)
- `{ onlineStatus, lastUpdatedAt }` (presence sweep)
- optional TTL on `lastUpdatedAt` when `LOCATION_CURRENT_RETENTION_DAYS > 0`

### `rider_location_history` (`RiderLocationHistory`)

`riderId`, `tripId` (nullable), `location` (GeoJSON Point), `latitude`, `longitude`, `heading`,
`speed`, `accuracy`, `altitude`, `source` (`GPS`/`NETWORK`/`MOCK`), `timestamp`.

Indexes:

- `{ riderId, timestamp }`
- `{ tripId, timestamp }`
- `{ timestamp }`
- `location` `2dsphere`
- optional TTL on `timestamp` when `LOCATION_HISTORY_RETENTION_DAYS > 0`

### TTL / retention strategy

History and current-location TTL indexes are opt-in via configuration so that old data can be
auto-expired by MongoDB without touching current-location reads. When TTL is disabled (default),
history is designed to be archived/purged out-of-band (e.g. scheduled export + range delete on
`timestamp`) without affecting the hot path, because current location lives in a separate
collection and Redis cache.

## Geospatial queries

`GET /location/nearby` uses a MongoDB `$geoNear` aggregation on the `2dsphere` index, returning
riders sorted by ascending distance with a computed `distanceMeters`, filtered by `maxDistance`
(radius, clamped to `LOCATION_NEARBY_MAX_RADIUS_METERS`), optional `vehicleType`, and `onlineOnly`.
The in-memory repository mirrors this with the Haversine formula for deterministic tests.

## API

All endpoints require a JWT. Responses use the shared `{ "data": ... }` envelope.

| Method & path                 | Roles                          | Purpose |
| ----------------------------- | ------------------------------ | ------- |
| `POST /location/update`       | `RIDER`                        | High-frequency GPS update (every 2–5s) |
| `POST /location/heartbeat`    | `RIDER`                        | Keepalive presence without a full fix |
| `GET /location/current`       | `RIDER`                        | Authenticated rider's latest location |
| `GET /location/nearby`        | `CUSTOMER`/`RIDER`/`ADMIN`/`SUPPORT` | Nearby riders sorted by distance |
| `GET /location/history`       | `RIDER`/`ADMIN`/`SUPPORT`      | Cursor-paginated history (self; others require admin) |
| `GET /location/rider/:riderId`| `ADMIN`/`SUPPORT`              | Internal/admin current-location lookup |

### `POST /location/update`

```json
{
  "latitude": 12.9716,
  "longitude": 77.5946,
  "heading": 90,
  "speed": 8.3,
  "accuracy": 5,
  "altitude": 920,
  "source": "GPS",
  "vehicleType": "BIKE",
  "tripId": null,
  "timestamp": "2026-07-16T10:00:00.000Z"
}
```

Response:

```json
{ "data": { "accepted": true, "reason": null, "location": { "riderId": "...", "onlineStatus": "ONLINE", "lastUpdatedAt": "..." } } }
```

`accepted` is `false` with `reason` `"stale"` (out-of-order) or `"duplicate"` (no meaningful
movement); duplicates still refresh presence via a heartbeat.

### `GET /location/nearby`

`?latitude=12.97&longitude=77.59&radius=3000&vehicleType=BIKE&onlineOnly=true&limit=50`

### `GET /location/history`

`?riderId=<uuid>&tripId=<uuid>&from=<iso>&to=<iso>&limit=50&cursor=<opaque>`

## Business rules

- Reject invalid coordinates (`LOCATION_INVALID_COORDINATES`).
- Reject impossible speeds — reported speed and implied speed (distance/time between fixes) above
  `LOCATION_MAX_SPEED_MPS` (`LOCATION_IMPOSSIBLE_SPEED`). The implied-speed guard leaves room for
  future GPS smoothing without changing the API contract.
- Ignore stale/out-of-order updates (older than the stored `lastUpdatedAt`) → emit `location.stale`.
- Ignore duplicate updates within `LOCATION_DUPLICATE_EPSILON_METERS` → emit `location.heartbeat`.

## Kafka events

Topics are defined centrally in `packages/kafka/src/topics.ts`. Each payload carries `riderId`,
`requestId`, and `traceId`.

| Topic                | Emitted when |
| -------------------- | ------------ |
| `location.updated`   | An update is accepted |
| `location.online`    | A rider transitions OFFLINE→ONLINE |
| `location.offline`   | Presence times out (sweeper) |
| `location.heartbeat` | A heartbeat/duplicate keepalive is received |
| `location.stale`     | A stale/out-of-order update is rejected |

## Redis usage

- **Current-location cache** (`location-service:current:<riderId>`, TTL
  `LOCATION_CURRENT_CACHE_TTL_SECONDS`): serves reads and the update pre-read hot path; refreshed
  on every accepted update and invalidated when a rider goes offline.
- **Presence marker** (`location-service:presence:<riderId>`, TTL
  `LOCATION_PRESENCE_TIMEOUT_SECONDS`): fast presence signal / last heartbeat.
- **Distributed sweep lock** (`location-service:lock:presence-sweep`): ensures a single instance
  performs a presence sweep at a time.

Redis is an accelerator only — correctness falls back to MongoDB, so the service runs with a Noop
cache when Redis is unavailable.

## Presence management

Presence is managed automatically. On each accepted update the rider is `ONLINE` and presence is
refreshed. A configurable sweep (`LOCATION_PRESENCE_SWEEP_INTERVAL_SECONDS`) marks riders whose
`lastUpdatedAt` is older than `LOCATION_PRESENCE_TIMEOUT_SECONDS` as `OFFLINE` and emits
`location.offline`. Timeouts are configuration, never hardcoded.

## Performance considerations

- High-throughput write path: a single indexed `findOneAndUpdate` upsert for current location and
  batched (`insertMany`) history writes via `BatchingHistoryWriter`
  (`LOCATION_HISTORY_BATCH_SIZE` / `LOCATION_HISTORY_FLUSH_INTERVAL_MS`).
- Duplicate and stale filtering avoid unnecessary history writes and events.
- Stateless instances: presence/cache in Redis, durable state in MongoDB; scale horizontally.
- Designed for 100k+ concurrent riders and millions of daily updates.

## Environment variables

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PORT` | `3007` | HTTP port |
| `MONGO_URL` / `REDIS_URL` / `KAFKA_BROKERS` | shared | Infra connections |
| `JWT_SECRET` | shared | Access-token verification |
| `LOCATION_MAX_SPEED_MPS` | `90` | Impossible-speed threshold |
| `LOCATION_DUPLICATE_EPSILON_METERS` | `2` | Duplicate movement threshold |
| `LOCATION_PRESENCE_TIMEOUT_SECONDS` | `30` | Online→offline timeout |
| `LOCATION_PRESENCE_SWEEP_INTERVAL_SECONDS` | `15` | Sweep cadence |
| `LOCATION_CURRENT_CACHE_TTL_SECONDS` | `10` | Current-location cache TTL |
| `LOCATION_HISTORY_BATCH_SIZE` | `100` | History flush batch size |
| `LOCATION_HISTORY_FLUSH_INTERVAL_MS` | `2000` | History flush interval |
| `LOCATION_HISTORY_RETENTION_DAYS` | `0` | History TTL (0 = disabled) |
| `LOCATION_CURRENT_RETENTION_DAYS` | `0` | Current-location TTL (0 = disabled) |
| `LOCATION_NEARBY_MAX_RADIUS_METERS` | `50000` | Max nearby radius |
| `LOCATION_NEARBY_DEFAULT_LIMIT` | `50` | Default nearby result count |
| `ENABLE_EXTERNAL_CONNECTIONS` | `false` | Toggles real Mongo/Redis/Kafka + background loops |

## Testing

```bash
npm run test --workspace @roundz/location-service
```

- `tests/location.repository.test.ts` — repository + geospatial behavior (nearby distance/radius,
  vehicle/online filters, stale lookup, history ordering).
- `tests/location.service.test.ts` — update acceptance, stale/duplicate handling, speed guards,
  presence transitions and sweeps, nearby, and history cursor pagination.
- `tests/location.routes.integration.test.ts` — auth/role enforcement, validation, and the full
  HTTP surface.

## Future integration with Trip Service (and beyond)

The service is designed so the following can be added without breaking existing APIs:
`WebSocket`/`MQTT` live streaming (the accepted-update path already emits `location.updated`),
geofencing and heat maps (GeoJSON + `2dsphere` already in place), ETA calculations, driver
heartbeat monitoring (presence primitives exist), and multi-region deployments (stateless
instances, Redis/Mongo-backed state). The Trip Service will consume `location.*` events and query
`GET /location/rider/:riderId` / `GET /location/nearby` for dispatch.
