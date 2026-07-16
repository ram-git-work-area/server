import type { ObjectStorageProvider, PutObjectInput } from '../interfaces';

abstract class PlaceholderObjectStorageAdapter implements ObjectStorageProvider {
  constructor(private readonly providerName: string) {}

  async putObject(input: PutObjectInput) {
    return { uri: `${this.providerName}://${input.bucket}/${input.key}` };
  }

  async getSignedReadUrl(bucket: string, key: string, _expiresInSeconds: number) {
    return `${this.providerName}://${bucket}/${key}?signed=true`;
  }

  async deleteObject(_bucket: string, _key: string) {
    return undefined;
  }
}

export class AwsS3StorageAdapter extends PlaceholderObjectStorageAdapter {
  constructor() {
    super('s3');
  }
}

export class GcpCloudStorageAdapter extends PlaceholderObjectStorageAdapter {
  constructor() {
    super('gcs');
  }
}

export class AzureBlobStorageAdapter extends PlaceholderObjectStorageAdapter {
  constructor() {
    super('azure-blob');
  }
}
