# Terraform

This directory keeps cloud-agnostic module boundaries and provider-specific environment compositions.

- `modules/` contains reusable abstractions such as network, postgres, mongo, redis, kafka, object storage, and secrets.
- `environments/aws`, `environments/gcp`, and `environments/azure` wire those modules to provider-specific resources.
- Provider-specific implementation should stay inside environment/module internals while service configuration remains environment-variable driven.
