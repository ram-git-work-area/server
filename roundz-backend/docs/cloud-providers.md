# Cloud Provider Abstraction

The application core depends on interfaces in `packages/cloud` rather than AWS, GCP, or Azure SDKs. Concrete adapters can be introduced per provider without changing services.

| Capability     | Current default     | Alternatives                         |
| -------------- | ------------------- | ------------------------------------ |
| Object storage | AWS S3              | GCP Cloud Storage, Azure Blob        |
| Secrets        | AWS Secrets Manager | GCP Secret Manager, Azure Key Vault  |
| Push           | Firebase FCM        | Provider-specific wrappers if needed |
| Payments       | Razorpay            | Stripe, regional providers           |
| Maps           | Google Maps         | OpenStreetMap                        |

Provider-specific Terraform and deployment wiring belongs in `infra/terraform/environments/*` and CI/CD environment variables.
