import type { CloudProvider, StorageProvider } from '@roundz/config';
import type { ObjectStorageProvider } from './interfaces';
import {
  AwsS3StorageAdapter,
  AzureBlobStorageAdapter,
  GcpCloudStorageAdapter,
} from './adapters/object-storage';

export function createObjectStorageProvider(
  storageProvider: StorageProvider,
  _cloudProvider: CloudProvider,
): ObjectStorageProvider {
  switch (storageProvider) {
    case 'gcs':
      return new GcpCloudStorageAdapter();
    case 'azure-blob':
      return new AzureBlobStorageAdapter();
    case 's3':
    case 'local':
    default:
      return new AwsS3StorageAdapter();
  }
}
