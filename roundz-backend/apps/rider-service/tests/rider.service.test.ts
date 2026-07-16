import { describe, expect, it } from 'vitest';
import { KafkaTopics } from '@roundz/kafka';
import { RiderService } from '../src/services/rider.service';
import type { RiderDocumentType } from '@prisma/client';
import {
  MemoryObjectStorageProvider,
  MemoryRiderCache,
  MemoryRiderEventPublisher,
  MemoryRiderRepository,
} from './memory-rider.repository';

const userId = 'rider-user-id';
const context = { requestId: 'unit-request', traceId: 'unit-trace' };

describe('RiderService', () => {
  it('onboards a rider on first profile update and publishes lifecycle events', async () => {
    const { service, events, repository } = createService();
    const result = await service.updateProfile(
      userId,
      { profilePhoto: 's3://bucket/photo.png' },
      context,
    );

    expect(result.data.riderCode).toMatch(/^RDR-/);
    expect(repository.riders).toHaveLength(1);
    expect(events.events.map((event) => event.topic)).toContain(KafkaTopics.RiderCreated);
    expect(events.events.at(-1)?.topic).toBe(KafkaTopics.RiderProfileUpdated);
  });

  it('rejects an invalid storage uri for profile photo', async () => {
    const { service } = createService();
    await expect(
      service.updateProfile(userId, { profilePhoto: 'not-a-uri' }, context),
    ).rejects.toMatchObject({ code: 'RIDER_INVALID_STORAGE_URI' });
  });

  it('prevents duplicate vehicle registration numbers', async () => {
    const { service } = createService();
    await service.updateProfile(userId, { profilePhoto: null }, context);
    await service.createVehicle(userId, vehicleInput('KA01AB1234', false), context);

    await expect(
      service.createVehicle(userId, vehicleInput('KA01AB1234', false), context),
    ).rejects.toMatchObject({ code: 'RIDER_VEHICLE_DUPLICATE' });
  });

  it('maintains a single primary vehicle', async () => {
    const { service, repository } = createService();
    await service.updateProfile(userId, { profilePhoto: null }, context);
    const first = await service.createVehicle(userId, vehicleInput('KA01AB0001', false), context);
    const second = await service.createVehicle(userId, vehicleInput('KA01AB0002', true), context);

    expect(first.data.isPrimary).toBe(true);
    expect(second.data.isPrimary).toBe(true);
    expect(repository.vehicles.find((vehicle) => vehicle.id === first.data.id)?.isPrimary).toBe(
      false,
    );
  });

  it('rejects duplicate active documents of the same type', async () => {
    const { service } = createService();
    await service.updateProfile(userId, { profilePhoto: null }, context);
    await service.uploadDocument(userId, documentInput('DRIVING_LICENSE'), context);

    await expect(
      service.uploadDocument(userId, documentInput('DRIVING_LICENSE'), context),
    ).rejects.toMatchObject({ code: 'RIDER_DOCUMENT_DUPLICATE' });
  });

  it('uploads documents through object storage and completes onboarding', async () => {
    const { service, storage } = createService();
    await service.updateProfile(userId, { profilePhoto: null }, context);
    await service.createVehicle(userId, vehicleInput('KA01AB9999', true), context);
    await service.uploadDocument(userId, documentInput('DRIVING_LICENSE'), context);
    await service.uploadDocument(userId, documentInput('VEHICLE_RC'), context);
    await service.uploadDocument(userId, documentInput('IDENTITY_PROOF'), context);

    const profile = await service.getProfile(userId);
    expect(storage.putObjects).toHaveLength(3);
    expect(profile.data.onboardingStatus).toBe('COMPLETED');
  });

  it('blocks going online until onboarding is complete and rider is approved', async () => {
    const { service, repository } = createService();
    await service.updateProfile(userId, { profilePhoto: null }, context);

    await expect(
      service.updateStatus(userId, { onlineStatus: 'ONLINE' }, context),
    ).rejects.toMatchObject({ code: 'RIDER_ONBOARDING_INCOMPLETE' });

    await service.createVehicle(userId, vehicleInput('KA01AB7777', true), context);
    await service.uploadDocument(userId, documentInput('DRIVING_LICENSE'), context);
    await service.uploadDocument(userId, documentInput('VEHICLE_RC'), context);
    await service.uploadDocument(userId, documentInput('IDENTITY_PROOF'), context);

    await expect(
      service.updateStatus(userId, { onlineStatus: 'ONLINE' }, context),
    ).rejects.toMatchObject({ code: 'RIDER_NOT_APPROVED' });

    const rider = await repository.findRiderByUserId(userId);
    await repository.updateRider(rider!.id, { approvalStatus: 'APPROVED' });

    const status = await service.updateStatus(userId, { onlineStatus: 'ONLINE' }, context);
    expect(status.data.onlineStatus).toBe('ONLINE');
  });

  it('updates preferences and validates language codes', async () => {
    const { service, events } = createService();
    await service.updateProfile(userId, { profilePhoto: null }, context);

    const updated = await service.updatePreferences(
      userId,
      { preferredLanguage: 'hi-IN', autoAcceptTrips: true },
      context,
    );

    await expect(
      service.updatePreferences(userId, { preferredLanguage: 'bad-value' }, context),
    ).rejects.toMatchObject({ code: 'RIDER_INVALID_LANGUAGE' });
    expect(updated.data.autoAcceptTrips).toBe(true);
    expect(events.events.at(-1)?.topic).toBe(KafkaTopics.RiderPreferencesUpdated);
  });
});

function createService() {
  const repository = new MemoryRiderRepository();
  const cache = new MemoryRiderCache();
  const storage = new MemoryObjectStorageProvider();
  const eventPublisher = new MemoryRiderEventPublisher();
  const service = new RiderService({
    repository,
    cache,
    eventPublisher,
    storageProvider: storage,
    documentBucket: 'test-rider-documents',
    cacheTtlSeconds: 60,
  });

  return { service, repository, cache, storage, events: eventPublisher };
}

function vehicleInput(registrationNumber: string, isPrimary: boolean) {
  return {
    vehicleType: 'BIKE' as const,
    brand: 'Honda',
    model: 'Activa',
    color: 'Black',
    registrationNumber,
    registrationState: 'KA',
    manufacturingYear: 2022,
    isPrimary,
  };
}

function documentInput(documentType: RiderDocumentType) {
  return {
    documentType,
    fileName: `${documentType}.png`,
    contentType: 'image/png' as const,
    sizeBytes: 4,
    body: Buffer.from('test'),
  };
}
