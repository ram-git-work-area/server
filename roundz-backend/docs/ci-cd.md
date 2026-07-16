# CI/CD Design

The pipeline is provider-neutral. Build, test, scan, and deploy steps are separated so AWS, GCP, Azure, or another provider can be selected by workflow environment variables.

Deployment should eventually perform:

1. OIDC-based cloud credential setup for the selected provider.
2. Terraform plan/apply for infrastructure.
3. Docker image build and push to the selected registry.
4. Helm upgrade/install into the selected Kubernetes cluster.
5. Smoke tests against health and readiness endpoints.
