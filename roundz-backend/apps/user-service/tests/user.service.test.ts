import { describe, expect, it } from 'vitest';
import { KafkaTopics } from '@roundz/kafka';
import { UserService } from '../src/services/user.service';
import {
  MemoryObjectStorageProvider,
  MemoryUserEventPublisher,
  MemoryUserRepository,
} from './memory-user.repository';

const userId = 'customer-user-id';
const context = { requestId: 'unit-test-request' };

describe('UserService', () => {
  it('updates a customer profile and publishes an event', async () => {
    const { service, events } = createService();

    const response = await service.updateProfile(
      userId,
      {
        firstName: 'Roundz',
        lastName: 'Customer',
        gender: 'PREFER_NOT_TO_SAY',
      },
      context,
    );

    expect(response.data.firstName).toBe('Roundz');
    expect(response.data.lastName).toBe('Customer');
    expect(events.events.at(-1)?.topic).toBe(KafkaTopics.UserProfileUpdated);
  });

  it('uploads a profile image using object storage abstraction', async () => {
    const { service, storage } = createService();

    const response = await service.uploadProfileImage(
      userId,
      {
        fileName: 'avatar.png',
        contentType: 'image/png',
        sizeBytes: 4,
        body: Buffer.from('test'),
      },
      context,
    );

    expect(storage.putObjects).toHaveLength(1);
    expect(storage.putObjects[0]?.bucket).toBe('test-user-profile-images');
    expect(response.data.profileImageUrl).toContain('local://test-user-profile-images/users/');
  });

  it('creates addresses and maintains a single default address', async () => {
    const { service, repository, events } = createService();

    const first = await service.createAddress(
      userId,
      {
        label: 'HOME',
        address: 'First address',
        latitude: 12.9,
        longitude: 77.6,
        isDefault: false,
      },
      context,
    );
    const second = await service.createAddress(
      userId,
      {
        label: 'WORK',
        address: 'Second address',
        latitude: 13,
        longitude: 77.7,
        isDefault: true,
      },
      context,
    );

    expect(first.data.isDefault).toBe(true);
    expect(second.data.isDefault).toBe(true);
    expect(repository.addresses.find((address) => address.id === first.data.id)?.isDefault).toBe(
      false,
    );
    expect(
      events.events.filter((event) => event.topic === KafkaTopics.UserAddressCreated),
    ).toHaveLength(2);
  });

  it('creates and deletes favorite locations', async () => {
    const { service, events } = createService();

    const favorite = await service.createFavoriteLocation(
      userId,
      {
        name: 'Airport',
        address: 'Airport road',
        latitude: 12.95,
        longitude: 77.65,
      },
      context,
    );
    const deletion = await service.deleteFavoriteLocation(userId, favorite.data.id, context);

    expect(favorite.data.name).toBe('Airport');
    expect(deletion.data.message).toBe('Favorite location deleted successfully');
    expect(events.events.at(-1)?.topic).toBe(KafkaTopics.UserFavoriteDeleted);
  });

  it('updates preferred language', async () => {
    const { service } = createService();

    const response = await service.updatePreferredLanguage(
      userId,
      {
        preferredLanguage: 'hi-IN',
      },
      context,
    );

    expect(response.data.preferredLanguage).toBe('hi-IN');
  });
});

function createService() {
  const repository = new MemoryUserRepository();
  const storage = new MemoryObjectStorageProvider();
  const events = new MemoryUserEventPublisher();
  const service = new UserService({
    repository,
    storageProvider: storage,
    eventPublisher: events,
    profileImageBucket: 'test-user-profile-images',
  });

  return { service, repository, storage, events };
}
