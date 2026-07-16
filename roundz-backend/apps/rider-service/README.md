# Rider Service

The Rider Service owns all rider-specific business logic for the Roundz platform: rider
onboarding, rider profile, vehicle management, KYC document management, online/offline
availability, the onboarding/approval workflow, and rider preferences.

It deliberately does **not** implement trip matching, GPS streaming, wallet/earnings,
notifications, or admin workflows. Those belong to their own services and consume the Kafka
events emitted here.

- **Port:** `3003`
- **Gateway prefix:** `/api/riders` → forwarded to `/riders`
- **Package:** `@roundz/rider-service`

## Architecture

The service follows the shared Clean Architecture flow used across the monorepo:

```
routes -> controller -> service -> repository -> database
```

- **Routes** (`src/routes/rider.routes.ts`): wire dependencies, register the JWT/role
  `preHandler`, and register HTTP endpoints. Dependencies are injectable for tests.
- **Controller** (`src/controllers/rider.controller.ts`): thin. Validates input with Zod,
  resolves the authenticated user, records structured logs with latency, and delegates to the
  service. No business logic.
- **Service** (`src/services/rider.service.ts`): all business rules, cache management,
  storage uploads, and event publishing.
- **Repository** (`src/repositories/rider.repository.ts`): the only layer that touches Prisma.
  Exposes a `RiderRepositoryPort` interface so tests can substitute an in-memory implementation.
- **Cache** (`src/services/rider-cache.service.ts`): Redis-backed cache with Noop/Memory
  variants.
- **Events** (`src/events/rider-events.publisher.ts`): Kafka publisher with Noop variant.

The rider is always resolved from the authenticated JWT subject (`sub`). The client-supplied
`riderId` is never trusted.

## Database models

All models live in the shared Prisma schema (`packages/database/prisma/schema.prisma`).

| Model             | Purpose                                                          |
| ----------------- | --------------------------------------------------------------- |
| `Rider`           | Rider account: `riderCode`, `status`, `onboardingStatus`, `approvalStatus`, `onlineStatus`, `profilePhoto`, `rating`, `totalTrips`. `userId` is unique and references `User`. |
| `Vehicle`         | Rider vehicles. `registrationNumber` is globally unique. One primary vehicle per rider. |
| `RiderDocument`   | KYC documents with `documentType`, `fileUrl`, `verificationStatus`, `rejectionReason`. |
| `RiderPreference` | Per-rider preferences (`preferredLanguage`, `autoAcceptTrips`, `receivePromotions`). |

Enums: `RiderStatus`, `RiderOnboardingStatus`, `RiderApprovalStatus`, `RiderOnlineStatus`,
`VehicleType`, `RiderDocumentType`, `DocumentVerificationStatus`.

Indexes are tuned for scale (`Rider` indexed by `approvalStatus`+`onboardingStatus`,
`onlineStatus`, `status`; `Vehicle` by `riderId`+`isPrimary`; `RiderDocument` by
`riderId`+`documentType`), and queries avoid N+1 by scoping every read to `riderId`.

## API

All endpoints require a valid JWT with role `RIDER`. Responses use the shared envelope
(`{ "data": ... }`) and list endpoints return `{ "data": [...], "meta": { "pagination": ... } }`.

### Profile

- `GET /riders/profile` — returns the rider profile. `404 RIDER_NOT_FOUND` before onboarding.
- `PUT /riders/profile` — onboards the rider on first call (creating a `riderCode` and emitting
  `rider.created`) and updates the profile photo.

```json
// PUT /riders/profile
{ "profilePhoto": "s3://roundz-rider-documents/riders/.../photo.png" }
```

### Vehicles

- `GET /riders/vehicles?limit=20&cursor=<uuid>`
- `POST /riders/vehicles`
- `PUT /riders/vehicles/:id`
- `DELETE /riders/vehicles/:id`
- `PATCH /riders/vehicles/:id/primary`

```json
// POST /riders/vehicles
{
  "vehicleType": "BIKE",
  "brand": "Honda",
  "model": "Activa",
  "color": "Black",
  "registrationNumber": "KA05MN2244",
  "registrationState": "KA",
  "manufacturingYear": 2022,
  "insuranceExpiry": "2027-01-01T00:00:00.000Z",
  "isPrimary": true
}
```

### Documents

- `GET /riders/documents?limit=20&cursor=<uuid>`
- `POST /riders/documents` — `multipart/form-data` with a `documentType` field and a `file` part.
- `DELETE /riders/documents/:id`

Documents are uploaded through the `ObjectStorageProvider` abstraction (`@roundz/cloud`); the
service never imports a cloud SDK directly.

```
POST /riders/documents
Content-Type: multipart/form-data; boundary=...
  field  documentType = DRIVING_LICENSE
  file   file = <binary>
```

### Availability

- `GET /riders/status` — returns `{ onlineStatus, onboardingStatus, approvalStatus }`.
- `PATCH /riders/status` — sets `ONLINE`, `OFFLINE`, or `BUSY`.

```json
// PATCH /riders/status
{ "onlineStatus": "ONLINE" }
```

### Preferences

- `GET /riders/preferences`
- `PATCH /riders/preferences`

```json
// PATCH /riders/preferences
{ "preferredLanguage": "hi-IN", "autoAcceptTrips": true, "receivePromotions": false }
```

## Business rules

- A rider must have a `User` account; the rider row is keyed by the unique `userId`.
- A rider can own multiple vehicles but exactly one primary vehicle. Deleting the primary
  promotes the most recent remaining vehicle.
- Registration numbers are globally unique (`RIDER_VEHICLE_DUPLICATE` on conflict).
- A rider can upload multiple KYC documents but not a duplicate **active** document of the same
  type (`RIDER_DOCUMENT_DUPLICATE`). A rejected document may be re-uploaded.
- `onboardingStatus` is derived automatically: `COMPLETED` once the rider has at least one
  vehicle and active documents for `DRIVING_LICENSE`, `VEHICLE_RC`, and `IDENTITY_PROOF`;
  `IN_PROGRESS` with partial data; otherwise `PENDING`.
- A rider cannot go `ONLINE`/`BUSY` until onboarding is `COMPLETED`
  (`RIDER_ONBOARDING_INCOMPLETE`) and `approvalStatus` is `APPROVED` (`RIDER_NOT_APPROVED`).
  Approval is granted by the future Admin Service.

## Kafka events

Published via `@roundz/kafka` (topics defined centrally in `packages/kafka/src/topics.ts`).
Every payload carries `riderId`, `userId`, `requestId`, and `traceId`.

| Topic                        | Emitted when                          |
| ---------------------------- | ------------------------------------- |
| `rider.created`              | A rider is onboarded                  |
| `rider.profile.updated`      | Profile fields change                 |
| `rider.vehicle.created`      | A vehicle is added                    |
| `rider.vehicle.updated`      | A vehicle is updated / set primary    |
| `rider.vehicle.deleted`      | A vehicle is removed                  |
| `rider.document.uploaded`    | A KYC document is uploaded            |
| `rider.document.deleted`     | A KYC document is deleted             |
| `rider.status.changed`       | Availability changes                  |
| `rider.preferences.updated`  | Preferences change                    |

These are consumed later by Trip, Notification, Analytics, and Admin services.

## Redis caching strategy

| Key                                | Value                | Invalidated on                               |
| ---------------------------------- | -------------------- | -------------------------------------------- |
| `rider-service:profile:<userId>`   | Rider profile        | profile/status/vehicle/document mutations    |
| `rider-service:vehicles:<riderId>` | Full vehicle list    | any vehicle mutation                         |
| `rider-service:preferences:<riderId>` | Rider preferences | preference updates                           |

TTL is controlled by `RIDER_CACHE_TTL_SECONDS`. Vehicle lists are owner-scoped and bounded, so
the full list is cached and paginated in memory. When Redis is not configured (local scaffold),
a Noop cache is used transparently.

## Environment variables

| Variable                    | Default                    | Description                          |
| --------------------------- | -------------------------- | ------------------------------------ |
| `PORT`                      | `3003`                     | HTTP port                            |
| `RIDER_DOCUMENT_BUCKET`     | `roundz-rider-documents`   | Object storage bucket for documents  |
| `RIDER_CACHE_TTL_SECONDS`   | `300`                      | Cache TTL                            |
| `JWT_SECRET`                | shared                     | Access-token verification            |
| `REDIS_URL` / `KAFKA_BROKERS` / `DATABASE_URL` | shared  | Infra connections                    |
| `STORAGE_PROVIDER` / `CLOUD_PROVIDER` | `s3` / `aws`      | Selects the object-storage adapter   |
| `ENABLE_EXTERNAL_CONNECTIONS` | `false`                  | Toggles real DB/Redis/Kafka wiring   |

## Testing

```bash
npm run test --workspace @roundz/rider-service
```

- `tests/rider.repository.test.ts` — repository invariants (single primary vehicle, primary
  promotion, registration uniqueness, active document lookup).
- `tests/rider.service.test.ts` — onboarding, vehicle/document rules, onboarding-status
  derivation, availability guard, preference validation, event emission.
- `tests/rider.routes.integration.test.ts` — auth/role enforcement, validation, and the full
  HTTP surface including multipart document upload.

## Future integration points

- **Admin Service** will set `approvalStatus` and document `verificationStatus` (consuming
  `rider.document.uploaded`).
- **Location Service** will own real-time GPS; only availability state is persisted here.
- **Trip Service** will update `rating` and `totalTrips` and consume `rider.status.changed`.
- Signed document read URLs can be issued via `ObjectStorageProvider.getSignedReadUrl` when a
  concrete cloud adapter is implemented.
