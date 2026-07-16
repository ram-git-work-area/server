import { describe, expect, it } from 'vitest';
import { MemoryRiderRepository } from './memory-rider.repository';

const userId = 'repository-rider-user';

async function seedRider(repository: MemoryRiderRepository) {
  return repository.createRider(userId, { riderCode: 'RDR-TEST123456' });
}

describe('RiderRepository behavior', () => {
  it('keeps a single primary vehicle per rider', async () => {
    const repository = new MemoryRiderRepository();
    const rider = await seedRider(repository);

    await repository.createVehicle(rider.id, vehicleData('KA01AA0001', false));
    const second = await repository.createVehicle(rider.id, vehicleData('KA01AA0002', true));

    expect(second.isPrimary).toBe(true);
    expect(repository.vehicles.filter((vehicle) => vehicle.isPrimary)).toHaveLength(1);
  });

  it('promotes another vehicle to primary when the primary is deleted', async () => {
    const repository = new MemoryRiderRepository();
    const rider = await seedRider(repository);

    const first = await repository.createVehicle(rider.id, vehicleData('KA01AA0003', false));
    const primary = await repository.createVehicle(rider.id, vehicleData('KA01AA0004', true));
    await repository.deleteVehicle(rider.id, primary.id);

    const remaining = await repository.findVehicle(rider.id, first.id);
    expect(remaining?.isPrimary).toBe(true);
  });

  it('detects duplicate registration numbers globally', async () => {
    const repository = new MemoryRiderRepository();
    const rider = await seedRider(repository);
    await repository.createVehicle(rider.id, vehicleData('KA01AA0005', true));

    const duplicate = await repository.findVehicleByRegistration('KA01AA0005');
    expect(duplicate).toBeTruthy();
  });

  it('finds active documents ignoring rejected ones', async () => {
    const repository = new MemoryRiderRepository();
    const rider = await seedRider(repository);
    await repository.createDocument(rider.id, {
      documentType: 'DRIVING_LICENSE',
      fileUrl: 's3://bucket/license.png',
      verificationStatus: 'REJECTED',
    });

    expect(await repository.findActiveDocumentByType(rider.id, 'DRIVING_LICENSE')).toBeNull();

    await repository.createDocument(rider.id, {
      documentType: 'DRIVING_LICENSE',
      fileUrl: 's3://bucket/license-2.png',
    });

    expect(await repository.findActiveDocumentByType(rider.id, 'DRIVING_LICENSE')).toBeTruthy();
  });
});

function vehicleData(registrationNumber: string, isPrimary: boolean) {
  return {
    vehicleType: 'CAR' as const,
    brand: 'Toyota',
    model: 'Etios',
    color: 'White',
    registrationNumber,
    registrationState: 'KA',
    manufacturingYear: 2021,
    insuranceExpiry: null,
    permitExpiry: null,
    isPrimary,
  };
}
