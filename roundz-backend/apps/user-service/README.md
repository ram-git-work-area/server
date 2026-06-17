# Roundz User Service

Customer User Service manages customer profile information, customer saved addresses, favorite locations, preferred language, and profile image upload metadata. It does not implement rider, trip, wallet, or notification business logic.

All `/users/*` endpoints require:

```http
Authorization: Bearer <customer-access-token>
```

Tokens are verified by the shared `@roundz/auth` package and must have role `CUSTOMER`.

## Standard response format

Single-resource responses:

```json
{
  "data": {}
}
```

Paginated responses:

```json
{
  "data": [],
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 0,
      "totalPages": 0
    }
  }
}
```

## Endpoints

### `GET /users/profile`

Returns the current customer's profile, or `null` if it has not been created.

```json
{
  "data": {
    "id": "uuid",
    "userId": "auth-user-id",
    "firstName": "Roundz",
    "lastName": "Customer",
    "gender": "PREFER_NOT_TO_SAY",
    "profileImageUrl": "s3://bucket/key",
    "dateOfBirth": "1995-01-01T00:00:00.000Z",
    "emergencyContactName": "Family",
    "emergencyContactPhone": "+15550001111",
    "preferredLanguage": "en",
    "createdAt": "2026-06-17T00:00:00.000Z",
    "updatedAt": "2026-06-17T00:00:00.000Z"
  }
}
```

### `PUT /users/profile`

```json
{
  "firstName": "Roundz",
  "lastName": "Customer",
  "gender": "PREFER_NOT_TO_SAY",
  "dateOfBirth": "1995-01-01",
  "emergencyContactName": "Family",
  "emergencyContactPhone": "+15550001111"
}
```

Publishes `user.profile.updated`.

### `POST /users/profile/image`

Uploads a profile image via multipart form-data using field `file`.

Supported content types:

- `image/jpeg`
- `image/png`
- `image/webp`

Maximum file size: 5 MiB.

The service writes through `ObjectStorageProvider`; it does not import AWS, GCP, or Azure SDKs directly.

Publishes `user.profile.updated`.

### `GET /users/addresses?page=1&limit=20`

Returns paginated saved addresses.

### `POST /users/addresses`

```json
{
  "label": "HOME",
  "address": "123 Roundz Street",
  "latitude": 12.9,
  "longitude": 77.6,
  "isDefault": true
}
```

Publishes `user.address.created`.

### `PUT /users/addresses/:id`

```json
{
  "label": "WORK",
  "address": "456 Office Road",
  "latitude": 13,
  "longitude": 77.7,
  "isDefault": true
}
```

Publishes `user.address.updated`.

### `DELETE /users/addresses/:id`

Deletes a saved address owned by the current customer.

Publishes `user.address.deleted`.

### `PATCH /users/addresses/:id/default`

Sets an address as default. The repository uses a Prisma transaction to unset any existing default address for the user first.

Publishes `user.address.updated`.

### `GET /users/favorites?page=1&limit=20`

Returns paginated favorite locations.

### `POST /users/favorites`

```json
{
  "name": "Airport",
  "address": "Airport Road",
  "latitude": 12.95,
  "longitude": 77.65
}
```

Publishes `user.favorite.created`.

### `DELETE /users/favorites/:id`

Deletes a favorite location owned by the current customer.

Publishes `user.favorite.deleted`.

### `PATCH /users/language`

```json
{
  "preferredLanguage": "hi-IN"
}
```

Publishes `user.profile.updated`.

## Environment variables

| Variable                      | Purpose                                                             |
| ----------------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                | PostgreSQL connection used by Prisma                                |
| `JWT_SECRET`                  | Access token verification secret shared with Auth Service           |
| `KAFKA_BROKERS`               | Kafka brokers for user events                                       |
| `CLOUD_PROVIDER`              | Cloud provider selector (`aws`, `gcp`, `azure`, `local`)            |
| `STORAGE_PROVIDER`            | Object storage selector (`s3`, `gcs`, `azure-blob`, `local`)        |
| `USER_PROFILE_IMAGE_BUCKET`   | Bucket/container name for profile images                            |
| `ENABLE_EXTERNAL_CONNECTIONS` | Enables real Postgres/Mongo/Redis/Kafka connections in the scaffold |

## Notes

- This service trusts Auth Service for identity and consumes the authenticated `sub` as `userId`.
- Only `CUSTOMER` role tokens can access these endpoints.
- Address ownership and favorite ownership are enforced at repository queries.
- Default address changes are transaction-backed.
- Profile image uploads use the shared cloud abstraction package only.
