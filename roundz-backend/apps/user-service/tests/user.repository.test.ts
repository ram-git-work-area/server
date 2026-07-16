import { describe, expect, it } from 'vitest';
import { MemoryUserRepository } from './memory-user.repository';

const userId = 'repository-user';

describe('UserRepository behavior', () => {
  it('keeps a single default address per user', async () => {
    const repository = new MemoryUserRepository();
    await repository.createAddress(userId, addressData('HOME', false));
    const second = await repository.createAddress(userId, addressData('WORK', true));

    expect(second.isDefault).toBe(true);
    expect(
      repository.addresses.filter((address) => address.userId === userId && address.isDefault),
    ).toHaveLength(1);
  });

  it('finds duplicate favorite locations for the same user', async () => {
    const repository = new MemoryUserRepository();
    await repository.createFavoriteLocation(userId, {
      name: 'Airport',
      address: 'Airport Road',
      latitude: 12.95,
      longitude: 77.65,
    });

    const duplicate = await repository.findDuplicateFavorite(userId, {
      name: 'Airport',
      address: 'Airport Road',
      latitude: 12.95,
      longitude: 77.65,
    });

    expect(duplicate).toBeTruthy();
  });
});

function addressData(label: 'HOME' | 'WORK', isDefault: boolean) {
  return {
    label,
    addressLine1: `${label} line 1`,
    addressLine2: null,
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    postalCode: '560001',
    latitude: 12.9716,
    longitude: 77.5946,
    isDefault,
  };
}
