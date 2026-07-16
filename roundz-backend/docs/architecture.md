# Architecture Notes

Roundz uses a modular monorepo so shared platform concerns can evolve consistently while each microservice remains independently deployable.

## Request flow

Routes only parse transport-level input and delegate to controllers. Controllers validate requests and call services. Services contain use-case orchestration. Repositories isolate persistence. External providers are reached through package-level interfaces and adapters.

## Events

Kafka topics established in the base:

- `trip.requested`
- `trip.accepted`
- `trip.cancelled`
- `trip.started`
- `trip.completed`
- `rider.location.updated`
- `wallet.transaction.created`
- `notification.send.requested`

Future event contracts should be versioned and documented before consumers rely on them.
