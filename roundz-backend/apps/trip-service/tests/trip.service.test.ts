import { describe, expect, it } from 'vitest';
import { KafkaTopics } from '@roundz/kafka';
import { TripService } from '../src/services/trip.service';
import type { CreateTripRequest } from '../src/schemas/trip.schemas';
import { MemoryTripCache } from '../src/services/trip-cache.service';
import { MemoryTripEventPublisher, MemoryTripRepository } from './memory-trip.repository';

const customerId = 'customer-1';
const context = { requestId: 'unit-request', traceId: 'unit-trace' };

describe('TripService', () => {
  it('creates a trip, records a timeline entry, and publishes trip.created', async () => {
    const { service, repository, events } = createService();
    const result = await service.createTrip(customerId, tripInput(), context);

    expect(result.data.status).toBe('REQUESTED');
    expect(result.data.tripNumber).toMatch(/^TRP-/);
    expect(repository.timelines).toHaveLength(1);
    expect(repository.timelines[0]!.status).toBe('REQUESTED');
    expect(events.topics()).toContain(KafkaTopics.TripCreated);
  });

  it('rejects identical pickup and drop locations', async () => {
    const { service } = createService();
    await expect(
      service.createTrip(
        customerId,
        tripInput({ dropLatitude: 12.9716, dropLongitude: 77.5946 }),
        context,
      ),
    ).rejects.toMatchObject({ code: 'TRIP_IDENTICAL_LOCATIONS' });
  });

  it('rejects invalid coordinates', async () => {
    const { service } = createService();
    await expect(
      service.createTrip(customerId, tripInput({ pickupLatitude: 200 }), context),
    ).rejects.toMatchObject({ code: 'TRIP_INVALID_COORDINATES' });
  });

  it('enforces a single active trip per customer', async () => {
    const { service } = createService();
    await service.createTrip(customerId, tripInput(), context);

    await expect(service.createTrip(customerId, tripInput(), context)).rejects.toMatchObject({
      code: 'TRIP_ACTIVE_EXISTS',
    });
  });

  it('allows a new trip after the previous one is cancelled', async () => {
    const { service } = createService();
    const first = await service.createTrip(customerId, tripInput(), context);
    await service.cancelTrip(customerId, first.data.id, { reason: 'changed mind' }, context);

    const second = await service.createTrip(customerId, tripInput(), context);
    expect(second.data.id).not.toBe(first.data.id);
  });

  it('cancels a trip with customer attribution and emits events', async () => {
    const { service, events } = createService();
    const created = await service.createTrip(customerId, tripInput(), context);
    const cancelled = await service.cancelTrip(
      customerId,
      created.data.id,
      { reason: 'changed mind' },
      context,
    );

    expect(cancelled.data.status).toBe('CANCELLED');
    expect(cancelled.data.cancelledBy).toBe('CUSTOMER');
    expect(cancelled.data.cancellationReason).toBe('changed mind');
    expect(events.topics()).toContain(KafkaTopics.TripCancelled);
    expect(events.topics()).toContain(KafkaTopics.TripStatusChanged);
  });

  it('rejects cancellation once the trip is in progress', async () => {
    const { service } = createService();
    const created = await service.createTrip(customerId, tripInput(), context);
    await service.updateStatus(created.data.id, { status: 'SEARCHING_RIDER' }, context);
    await service.updateStatus(created.data.id, { status: 'RIDER_ASSIGNED' }, context);
    await service.updateStatus(created.data.id, { status: 'RIDER_ARRIVING' }, context);
    await service.updateStatus(created.data.id, { status: 'OTP_PENDING' }, context);
    await service.updateStatus(created.data.id, { status: 'IN_PROGRESS' }, context);

    await expect(
      service.cancelTrip(customerId, created.data.id, { reason: 'too late' }, context),
    ).rejects.toMatchObject({ code: 'TRIP_NOT_CANCELLABLE' });
  });

  it('publishes trip.search.started when moving to SEARCHING_RIDER', async () => {
    const { service, events } = createService();
    const created = await service.createTrip(customerId, tripInput(), context);
    await service.updateStatus(created.data.id, { status: 'SEARCHING_RIDER' }, context);

    expect(events.topics()).toContain(KafkaTopics.TripSearchStarted);
  });

  it('rejects invalid state transitions', async () => {
    const { service } = createService();
    const created = await service.createTrip(customerId, tripInput(), context);

    await expect(
      service.updateStatus(created.data.id, { status: 'COMPLETED' }, context),
    ).rejects.toMatchObject({ code: 'TRIP_INVALID_TRANSITION' });
  });

  it('assigns a rider via the internal status update', async () => {
    const { service } = createService();
    const created = await service.createTrip(customerId, tripInput(), context);
    await service.updateStatus(created.data.id, { status: 'SEARCHING_RIDER' }, context);
    const assigned = await service.updateStatus(
      created.data.id,
      { status: 'RIDER_ASSIGNED', riderId: '11111111-1111-4111-8111-111111111111' },
      context,
    );

    expect(assigned.data.status).toBe('RIDER_ASSIGNED');
    expect(assigned.data.riderId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('enforces trip ownership on reads', async () => {
    const { service } = createService();
    const created = await service.createTrip(customerId, tripInput(), context);

    await expect(service.getTrip(created.data.id, 'other-customer', false)).rejects.toMatchObject({
      code: 'TRIP_FORBIDDEN',
    });
    const asOwner = await service.getTrip(created.data.id, customerId, false);
    const asAdmin = await service.getTrip(created.data.id, 'admin-user', true);
    expect(asOwner.data.id).toBe(created.data.id);
    expect(asAdmin.data.id).toBe(created.data.id);
  });

  it('returns 404 for an unknown trip', async () => {
    const { service } = createService();
    await expect(service.getTrip('missing', customerId, false)).rejects.toMatchObject({
      code: 'TRIP_NOT_FOUND',
    });
  });

  it('lists trips with a status filter and pagination metadata', async () => {
    const { service, repository } = createService();
    const created = await service.createTrip(customerId, tripInput(), context);
    await service.cancelTrip(customerId, created.data.id, { reason: 'x' }, context);
    await service.createTrip(customerId, tripInput(), context);

    const all = await service.listTrips(customerId, { limit: 1 });
    expect(all.data).toHaveLength(1);
    expect(all.meta.pagination.hasMore).toBe(true);

    const cancelled = await service.listTrips(customerId, { limit: 10, status: 'CANCELLED' });
    expect(cancelled.data).toHaveLength(1);
    expect(cancelled.data[0]!.status).toBe('CANCELLED');
    expect(repository.trips).toHaveLength(2);
  });
});

function createService() {
  const repository = new MemoryTripRepository();
  const cache = new MemoryTripCache();
  const events = new MemoryTripEventPublisher();
  const service = new TripService({
    repository,
    cache,
    eventPublisher: events,
    cacheTtlSeconds: 60,
  });
  return { service, repository, cache, events };
}

function tripInput(overrides: Partial<CreateTripRequest> = {}): CreateTripRequest {
  return {
    vehicleType: 'BIKE',
    tripType: 'RIDE',
    pickupLatitude: 12.9716,
    pickupLongitude: 77.5946,
    pickupAddress: 'MG Road, Bengaluru',
    dropLatitude: 12.9352,
    dropLongitude: 77.6245,
    dropAddress: 'Koramangala, Bengaluru',
    estimatedDistance: 6500,
    estimatedDuration: 1200,
    estimatedFare: 145.5,
    paymentMethod: 'CASH',
    ...overrides,
  };
}
