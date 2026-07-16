import type { SecretsProvider } from '../interfaces';

abstract class PlaceholderSecretsAdapter implements SecretsProvider {
  constructor(private readonly providerName: string) {}

  async getSecret(name: string): Promise<string> {
    throw new Error(`${this.providerName} secret adapter is not wired yet: ${name}`);
  }
}

export class AwsSecretsManagerAdapter extends PlaceholderSecretsAdapter {
  constructor() {
    super('aws-secrets-manager');
  }
}

export class GcpSecretManagerAdapter extends PlaceholderSecretsAdapter {
  constructor() {
    super('gcp-secret-manager');
  }
}

export class AzureKeyVaultAdapter extends PlaceholderSecretsAdapter {
  constructor() {
    super('azure-key-vault');
  }
}
