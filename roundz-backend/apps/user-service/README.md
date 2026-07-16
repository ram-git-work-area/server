# Roundz User Service

Customer-only User Service for Roundz. It owns customer profile data, saved addresses, favorite places, emergency contact information, preferences/settings, and profile images.

It does **not** implement Rider, Trip, Wallet, Notification, or Admin business logic.

## Architecture

Flow:

```text
routes -> controllers -> services -> repositories -> Prisma/PostgreSQL
```

- Routes apply JWT authentication and CUSTOMER role checks.
- Controllers validate request bodies, params, queries, and log request context.
- Services enforce business rules, cache reads, publish events, and use cloud storage abstractions.
- Repositories are the only layer that accesses Prisma.
- Events are published through Kafka abstractions for future Notification and Analytics consumers.

## Database models

### UserProfile

Stores customer profile fields: names, gender, profile image URL, date of birth, emergency contact, preferred language, and timestamps.

### Address

Stores customer saved addresses with structured address lines, coordinates, default flag, and timestamps. Queries are indexed by `userId`, default status, city, and creation order.

### FavoriteLocation

Stores favorite places with a unique `(userId, name, address)` constraint to prevent duplicates.

### UserSettings

Stores customer preferences for push/email/marketing notifications, dark mode, language, and timezone.

## Authentication

Every `/users/*` endpoint requires:

```http
Authorization: Bearer <access-token>
```

The service validates JWTs using the shared `@roundz/auth` helpers and only accepts `CUSTOMER` role tokens. It never trusts client-supplied `userId`; the user ID always comes from JWT `sub`.

## API endpoints

### `GET /users/profile`

Returns the current customer profile.

### `PUT /users/profile`

```json
{
  "firstName": "Roundz",
  "lastName": "Customer",
  "gender": "PREFER_NOT_TO_SAY",
  "dateOfBirth": "1995-01-01",
  "preferredLanguage": "en"
}
```

### `POST /users/profile/image`

Multipart upload using field `file`.

Supported content types:

- `image/jpeg`
- `image/png`
- `image/webp`

Maximum size: 5 MiB.

Uses `ObjectStorageProvider`; no AWS/GCP/Azure SDK is imported by this service.

### `DELETE /users/profile/image`

Clears the profile image URL and attempts to delete the stored object when the URI can be parsed.

### `GET /users/addresses?limit=20&cursor=<id>`

Cursor-paginated saved addresses.

### `POST /users/addresses`

```json
{
  "label": "HOME",
  "addressLine1": "123 Roundz Street",
  "addressLine2": "Near Metro",
  "city": "Bengaluru",
  "state": "Karnataka",
  "country": "India",
  "postalCode": "560001",
  "latitude": 12.9716,
  "longitude": 77.5946,
  "isDefault": true
}
```

### `PUT /users/addresses/:id`

Updates an owned address. Latitude and longitude must be updated together.

### `DELETE /users/addresses/:id`

Deletes an owned address.

### `PATCH /users/addresses/:id/default`

Sets one owned address as default. A transaction unsets any existing default address first.

### `GET /users/favorites?limit=20&cursor=<id>`

Cursor-paginated favorite locations.

### `POST /users/favorites`

```json
{
  "name": "Airport",
  "address": "Airport Road",
  "latitude": 12.95,
  "longitude": 77.65
}
```

### `PUT /users/favorites/:id`

Updates an owned favorite location. Duplicate favorites are rejected.

### `DELETE /users/favorites/:id`

Deletes an owned favorite location.

### `GET /users/settings`

Returns settings, creating defaults if none exist.

### `PATCH /users/settings`

```json
{
  "pushNotificationsEnabled": true,
  "marketingNotificationsEnabled": false,
  "emailNotificationsEnabled": true,
  "darkModeEnabled": true,
  "language": "hi-IN",
  "timezone": "Asia/Kolkata"
}
```

### `PATCH /users/emergency-contact`

```json
{
  "emergencyContactName": "Family",
  "emergencyContactPhone": "+15550001111"
}
```

## Standard response examples

Single resource:

```json
{
  "data": {
    "id": "uuid"
  }
}
```

Cursor collection:

```json
{
  "data": [],
  "meta": {
    "pagination": {
      "limit": 20,
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

## Kafka events

- `user.profile.updated`
- `user.address.created`
- `user.address.updated`
- `user.address.deleted`
- `user.favorite.created`
- `user.favorite.updated`
- `user.favorite.deleted`
- `user.settings.updated`

These are intended for future Notification and Analytics consumers.

## Environment variables

| Variable                      | Purpose                                             |
| ----------------------------- | --------------------------------------------------- |
| `DATABASE_URL`                | PostgreSQL connection used by Prisma                |
| `REDIS_URL`                   | Redis connection for profile/settings cache         |
| `KAFKA_BROKERS`               | Kafka brokers for user events                       |
| `JWT_SECRET`                  | Access token verification secret                    |
| `USER_PROFILE_IMAGE_BUCKET`   | Object storage bucket/container for profile images  |
| `USER_CACHE_TTL_SECONDS`      | Redis cache TTL for profile/settings                |
| `CLOUD_PROVIDER`              | Cloud provider selector                             |
| `STORAGE_PROVIDER`            | Object storage provider selector                    |
| `ENABLE_EXTERNAL_CONNECTIONS` | Enables real Postgres/Mongo/Redis/Kafka connections |

## Caching strategy

- `GET /users/profile` caches `UserProfile` by `userId`.
- `GET /users/settings` caches `UserSettings` by `userId`.
- Profile cache is invalidated after profile, profile image, and emergency contact updates.
- Settings cache is invalidated after settings updates.

## Future extension points

- Add avatar moderation as a separate async consumer.
- Add address geocoding through MapsProvider without changing controller logic.
- Add analytics consumers for emitted Kafka events.
- Add field-level audit logs in a separate audit service.
