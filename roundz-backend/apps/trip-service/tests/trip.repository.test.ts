import { describe, expect, it } from 'vitest';
import { MemoryTripRepository } from './memory-trip.repository';

function tripData(tripNumber: string, customerId = 'customer-1') {
  return {
    tripNumber,
    customerId,
    vehicleType: 'BIKE' as const,
    tripType: 'RIDE' as const,
    pickupLatitude: 12.9716,
    pickupLongitude: 77.5946,
    pickupAddress: 'A',
    dropLatitude: 12.9352,
    dropLongitude: 77.6245,
    dropAddress: 'B',
    estimatedDistance: 6500,
    estimatedDuration: 1200,
    estimatedFare: 145.5,
    paymentMethod: 'CASH' as const,
  };
}

describe('TripRepository behavior', () => {
  it('creates a trip together with an initial timeline entry', async () => {
    const repository = new MemoryTripRepository();
    const trip = await repository.createWithTimeline(tripData('TRP-1'), 'Trip requested');

    const detail = await repository.findByIdWithTimeline(trip.id);
    expect(detail?.timeline).toHaveLength(1);
    expect(detail?.timeline[0]!.description).toBe('Trip requested');
  });

  it('rejects duplicate trip numbers', async () => {
    const repository = new MemoryTripRepository();
    await repository.createWithTimeline(tripData('TRP-DUP'), 'Trip requested');

    await expect(
      repository.createWithTimeline(tripData('TRP-DUP'), 'Trip requested'),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('finds only active trips for a customer', async () => {
    const repository = new MemoryTripRepository();
    const trip = await repository.createWithTimeline(tripData('TRP-2'), 'Trip requested');

    expect(await repository.findActiveByCustomer('customer-1')).not.toBeNull();

    await repository.updateStatusWithTimeline(trip.id, {
      status: 'COMPLETED',
      description: 'done',
    });

    expect(await repository.findActiveByCustomer('customer-1')).toBeNull();
  });

  it('appends a timeline entry on each status update', async () => {
    const repository = new MemoryTripRepository();
    const trip = await repository.createWithTimeline(tripData('TRP-3'), 'Trip requested');
    await repository.updateStatusWithTimeline(trip.id, {
      status: 'SEARCHING_RIDER',
      description: 'searching',
    });

    const detail = await repository.findByIdWithTimeline(trip.id);
    expect(detail?.timeline).toHaveLength(2);
    expect(detail?.timeline.at(-1)!.status).toBe('SEARCHING_RIDER');
  });

  it('lists trips filtered by status with newest first', async () => {
    const repository = new MemoryTripRepository();
    const a = await repository.createWithTimeline(tripData('TRP-4'), 'Trip requested');
    await repository.createWithTimeline(tripData('TRP-5'), 'Trip requested');
    await repository.updateStatusWithTimeline(a.id, { status: 'CANCELLED', description: 'x' });

    const cancelled = await repository.list({
      customerId: 'customer-1',
      limit: 10,
      status: 'CANCELLED',
    });
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.id).toBe(a.id);
  });
});
