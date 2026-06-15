# Roundz Auth Service

Production-grade authentication and identity base for Roundz. This service owns identity records, password authentication, OTP-ready phone flows, refresh-token sessions, and role-based access helpers.

## Roles

- `CUSTOMER`
- `RIDER`
- `ADMIN`
- `SUPPORT`

Self-registration currently allows `CUSTOMER` and `RIDER`. `ADMIN` and `SUPPORT` accounts should be provisioned through a controlled back-office flow later.

## Endpoints

### `POST /auth/register`

Registers a user with email/password.

```json
{
  "email": "customer@example.com",
  "phone": "+15550001111",
  "password": "password123",
  "fullName": "Roundz Customer",
  "role": "CUSTOMER"
}
```

Response:

```json
{
  "user": {
    "id": "uuid",
    "email": "customer@example.com",
    "phone": "+15550001111",
    "fullName": "Roundz Customer",
    "role": "CUSTOMER",
    "status": "PENDING_VERIFICATION",
    "emailVerified": false,
    "phoneVerified": false,
    "lastLoginAt": null,
    "createdAt": "2026-06-15T00:00:00.000Z",
    "updatedAt": "2026-06-15T00:00:00.000Z"
  },
  "tokens": {
    "accessToken": "jwt",
    "refreshToken": "jwt",
    "tokenType": "Bearer",
    "expiresInSeconds": 900,
    "refreshExpiresInSeconds": 2592000
  }
}
```

### `POST /auth/login`

```json
{
  "email": "customer@example.com",
  "password": "password123"
}
```

Returns the same auth response as registration. Invalid credentials always return a generic error message.

### `POST /auth/refresh`

```json
{
  "refreshToken": "jwt"
}
```

Returns a rotated access/refresh token pair. The previous refresh token is revoked.

### `POST /auth/logout`

Requires `Authorization: Bearer <accessToken>`.

```json
{
  "refreshToken": "jwt"
}
```

Revokes the submitted refresh token and the current session when available.

### `POST /auth/otp/request`

Placeholder for login/register via phone OTP. No SMS is sent yet.

```json
{
  "phone": "+15550001111",
  "purpose": "LOGIN"
}
```

### `POST /auth/otp/verify`

Uses placeholder OTP code `000000` for local/base flow only.

```json
{
  "phone": "+15550001111",
  "code": "000000",
  "purpose": "REGISTER",
  "fullName": "Roundz Customer",
  "role": "CUSTOMER"
}
```

### `GET /auth/me`

Requires `Authorization: Bearer <accessToken>`. Returns the current safe user profile.

### `POST /auth/change-password`

Requires `Authorization: Bearer <accessToken>`.

```json
{
  "currentPassword": "password123",
  "newPassword": "newPassword123"
}
```

Changes the password, revokes all refresh tokens and sessions, and publishes `auth.password_changed`.

### `POST /auth/forgot-password`

Placeholder only.

```json
{
  "email": "customer@example.com"
}
```

Always returns a generic accepted message.

### `POST /auth/verify-email`

Placeholder only.

```json
{
  "token": "verification-token"
}
```

## Environment variables

| Variable                               | Purpose                                                             |
| -------------------------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                         | PostgreSQL connection used by Prisma                                |
| `REDIS_URL`                            | Redis connection for login/OTP rate limits                          |
| `KAFKA_BROKERS`                        | Kafka brokers for auth events                                       |
| `JWT_SECRET`                           | Signing secret for access and refresh JWTs                          |
| `JWT_ACCESS_TOKEN_EXPIRES_IN`          | JWT access token expiry, default `15m`                              |
| `JWT_REFRESH_TOKEN_EXPIRES_IN`         | JWT refresh token expiry, default `30d`                             |
| `JWT_ACCESS_TOKEN_TTL_SECONDS`         | Numeric access token TTL for responses                              |
| `JWT_REFRESH_TOKEN_TTL_SECONDS`        | Numeric refresh token TTL for DB/session expiry                     |
| `AUTH_LOGIN_RATE_LIMIT_MAX`            | Login attempts allowed per window                                   |
| `AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS` | Login rate-limit window                                             |
| `AUTH_OTP_RATE_LIMIT_MAX`              | OTP requests allowed per window                                     |
| `AUTH_OTP_RATE_LIMIT_WINDOW_SECONDS`   | OTP rate-limit window                                               |
| `AUTH_OTP_TTL_SECONDS`                 | OTP placeholder validity                                            |
| `ENABLE_EXTERNAL_CONNECTIONS`          | Enables real Postgres/Mongo/Redis/Kafka connections in the scaffold |

## Security notes

- Passwords are hashed with Argon2.
- Access tokens are short-lived JWTs.
- Refresh tokens are signed JWTs but only their SHA-256 hashes are stored in PostgreSQL.
- Refresh token rotation revokes the previous refresh token.
- Logout revokes refresh tokens and the active user session.
- Password changes revoke all refresh tokens and sessions for the user.
- Login and OTP endpoints are rate-limited through Redis when external connections are enabled.
- Login attempts are persisted for auditing.
- Password hashes are never returned by schemas or DTOs.
- All request bodies are validated with Zod.
- Auth events are published to Kafka through the shared producer abstraction.
- OTP/SMS/email delivery is intentionally a no-op provider placeholder for now.
