import { describe, expect, it } from 'vitest';
import { KafkaTopics } from '@roundz/kafka';
import { UserService } from '../src/services/user.service';
import {
  MemoryObjectStorageProvider,
  MemoryUserCache,
  MemoryUserEventPublisher,
  MemoryUserRepository,
} from './memory-user.repository';

const userId = 'customer-user-id';
const context = { requestId: 'unit-request', traceId: 'unit-trace' };

describe('UserService', () => {
  it('updates and caches customer profile data', async () => {
    const { service, cache, events } = createService();
    const updated = await service.updateProfile(
      userId,
      {
        firstName: 'Roundz',
        lastName: 'Customer',
        preferredLanguage: 'en',
      },
      context,
    );
    const fetched = await service.getProfile(userId);

    expect(updated.data.firstName).toBe('Roundz');
    expect(fetched.data?.lastName).toBe('Customer');
    expect(await cache.getJson(`user-service:profile:${userId}`)).toBeTruthy();
    expect(events.events.at(-1)?.topic).toBe(KafkaTopics.UserProfileUpdated);
  });

  it('uploads and deletes profile images through object storage', async () => {
    const { service, storage } = createService();
    const uploaded = await service.uploadProfileImage(
      userId,
      {
        fileName: 'avatar.png',
        contentType: 'image/png',
        sizeBytes: 4,
        body: Buffer.from('test'),
      },
      context,
    );
    const deleted = await service.deleteProfileImage(userId, context);

    expect(uploaded.data.profileImageUrl).toContain('local://test-profile-images/users/');
    expect(storage.putObjects).toHaveLength(1);
    expect(storage.deletedObjects).toHaveLength(1);
    expect(deleted.data.profileImageUrl).toBeNull();
  });

  it('maintains only one default address', async () => {
    const { service, repository } = createService();
    const first = await service.createAddress(userId, addressInput('HOME', false), context);
    const second = await service.createAddress(userId, addressInput('WORK', true), context);

    expect(first.data.isDefault).toBe(true);
    expect(second.data.isDefault).toBe(true);
    expect(repository.addresses.find((address) => address.id === first.data.id)?.isDefault).toBe(
      false,
    );
  });

  it('prevents duplicate favorite locations and publishes updates', async () => {
    const { service, events } = createService();
    const favorite = await service.createFavoriteLocation(
      userId,
      {
        name: 'Airport',
        address: 'Airport Road',
        latitude: 12.95,
        longitude: 77.65,
      },
      context,
    );

    await expect(
      service.createFavoriteLocation(
        userId,
        {
          name: 'Airport',
          address: 'Airport Road',
          latitude: 12.95,
          longitude: 77.65,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'USER_FAVORITE_DUPLICATE' });

    const updated = await service.updateFavoriteLocation(
      userId,
      favorite.data.id,
      { name: 'Airport Terminal' },
      context,
    );

    expect(updated.data.name).toBe('Airport Terminal');
    expect(events.events.at(-1)?.topic).toBe(KafkaTopics.UserFavoriteUpdated);
  });

  it('updates settings and validates language/timezone', async () => {
    const { service, events } = createService();
    const settings = await service.updateSettings(
      userId,
      {
        darkModeEnabled: true,
        language: 'hi-IN',
        timezone: 'Asia/Kolkata',
      },
      context,
    );

    await expect(
      service.updateSettings(userId, { language: 'bad-value' }, context),
    ).rejects.toMatchObject({
      code: 'USER_INVALID_LANGUAGE',
    });
    expect(settings.data.darkModeEnabled).toBe(true);
    expect(events.events.at(-1)?.topic).toBe(KafkaTopics.UserSettingsUpdated);
  });
});

function createService() {
  const repository = new MemoryUserRepository();
  const cache = new MemoryUserCache();
  const storage = new MemoryObjectStorageProvider();
  const events = new MemoryUserEventPublisher();
  const service = new UserService({
    repository,
    cache,
    eventPublisher: events,
    storageProvider: storage,
    profileImageBucket: 'test-profile-images',
    cacheTtlSeconds: 60,
  });

  return { service, repository, cache, storage, events };
}

function addressInput(label: 'HOME' | 'WORK', isDefault: boolean) {
  return {
    label,
    addressLine1: `${label} line 1`,
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    postalCode: '560001',
    latitude: 12.9716,
    longitude: 77.5946,
    isDefault,
  };
}
