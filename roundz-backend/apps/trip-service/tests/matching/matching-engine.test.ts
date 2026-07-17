import { describe, expect, it } from 'vitest';
import { InMemoryDistributedLock } from '@roundz/redis';
import { MemoryDispatchStore } from '../../src/services/matching/dispatch.store';
import { createHarness, eligibleSnapshot, nearbyRider } from './harness';

const PICKUP = { latitude: 12.9716, longitude: 77.5946 };

// ~222m, ~445m, ~667m north of pickup (all inside the 2km ring).
const NEAR_A = PICKUP.latitude + 0.002;
const NEAR_B = PICKUP.latitude + 0.004;
const NEAR_C = PICKUP.latitude + 0.006;
// ~3.3km north (outside 2km, inside 5km).
const MID = PICKUP.latitude + 0.03;

describe('MatchingEngine.startMatching', () => {
  it('moves the trip to SEARCHING_RIDER and dispatches the nearest batch', async () => {
    const h = await createHarness({
      pickup: PICKUP,
      riders: [
        nearbyRider('rA', NEAR_A, PICKUP.longitude),
        nearbyRider('rB', NEAR_B, PICKUP.longitude),
        nearbyRider('rC', NEAR_C, PICKUP.longitude),
      ],
      snapshots: [eligibleSnapshot('rA'), eligibleSnapshot('rB'), eligibleSnapshot('rC')],
      config: { batchSize: 2 },
    });

    await h.engine.startMatching(h.trip.id, { requestId: 'req-1' });

    const trip = await h.tripRepository.findById(h.trip.id);
    expect(trip?.status).toBe('SEARCHING_RIDER');

    const session = await h.sessionRepository.findByTripId(h.trip.id);
    expect(session?.status).toBe('DISPATCHING');
    expect(session?.currentBatch).toBe(1);
    expect(session?.notifiedRiderCount).toBe(2);

    expect(h.events.countOf('trip.search.started')).toBe(1);
    expect(h.events.countOf('trip.rider.notified')).toBe(2);

    // Nearest two riders are the ones notified.
    const notified = h.events.events
      .filter((event) => event.topic === 'trip.rider.notified')
      .map((event) => event.payload.riderId);
    expect(notified).toEqual(['rA', 'rB']);
  });

  it('skips ineligible riders when building the candidate batch', async () => {
    const h = await createHarness({
      pickup: PICKUP,
      riders: [
        nearbyRider('busy', NEAR_A, PICKUP.longitude),
        nearbyRider('good', NEAR_B, PICKUP.longitude),
      ],
      snapshots: [eligibleSnapshot('busy', { isBusy: true }), eligibleSnapshot('good')],
      config: { batchSize: 5 },
    });

    await h.engine.startMatching(h.trip.id);

    const notified = h.events.events
      .filter((event) => event.topic === 'trip.rider.notified')
      .map((event) => event.payload.riderId);
    expect(notified).toEqual(['good']);
  });

  it('does not start when the trip lock is already held by another worker', async () => {
    const lock = new InMemoryDistributedLock();
    const h = await createHarness({
      lock,
      pickup: PICKUP,
      riders: [nearbyRider('rA', NEAR_A, PICKUP.longitude)],
      snapshots: [eligibleSnapshot('rA')],
    });

    const held = await lock.acquire(`trip-service:matching:lock:trip:${h.trip.id}`, 5000);
    expect(held).not.toBeNull();

    await h.engine.startMatching(h.trip.id);

    expect(await h.sessionRepository.findByTripId(h.trip.id)).toBeNull();
    expect(h.events.events).toHaveLength(0);
  });
});

describe('MatchingEngine radius expansion and failure', () => {
  it('expands the radius when no rider is found nearby', async () => {
    const h = await createHarness({
      pickup: PICKUP,
      riders: [nearbyRider('midRider', MID, PICKUP.longitude)],
      snapshots: [eligibleSnapshot('midRider')],
    });

    await h.engine.startMatching(h.trip.id);

    expect(h.events.countOf('trip.search.expanded')).toBeGreaterThanOrEqual(1);
    const session = await h.sessionRepository.findByTripId(h.trip.id);
    expect(session?.currentRadiusMeters).toBe(5000);
    expect(session?.status).toBe('DISPATCHING');
    const notified = h.events.events
      .filter((event) => event.topic === 'trip.rider.notified')
      .map((event) => event.payload.riderId);
    expect(notified).toEqual(['midRider']);
  });

  it('fails matching and moves the trip to FAILED when no rider exists', async () => {
    const h = await createHarness({ pickup: PICKUP, riders: [], snapshots: [] });

    await h.engine.startMatching(h.trip.id);

    const trip = await h.tripRepository.findById(h.trip.id);
    expect(trip?.status).toBe('FAILED');
    const session = await h.sessionRepository.findByTripId(h.trip.id);
    expect(session?.status).toBe('FAILED');
    expect(session?.failureReason).toBe('NO_RIDERS_AVAILABLE');
    expect(h.events.countOf('trip.search.failed')).toBe(1);
  });
});

describe('MatchingEngine rider decisions', () => {
  it('assigns a rider on acceptance and drives the trip to RIDER_ARRIVING', async () => {
    const h = await createHarness({
      pickup: PICKUP,
      riders: [
        nearbyRider('rA', NEAR_A, PICKUP.longitude),
        nearbyRider('rB', NEAR_B, PICKUP.longitude),
      ],
      snapshots: [eligibleSnapshot('rA'), eligibleSnapshot('rB')],
      config: { batchSize: 2 },
    });
    await h.engine.startMatching(h.trip.id);

    await h.engine.submitRiderDecision(h.trip.id, 'rA', true, { requestId: 'req-accept' });

    const trip = await h.tripRepository.findById(h.trip.id);
    expect(trip?.status).toBe('RIDER_ARRIVING');
    expect(trip?.riderId).toBe('rA');

    const session = await h.sessionRepository.findByTripId(h.trip.id);
    expect(session?.status).toBe('ASSIGNED');
    expect(session?.assignedRiderId).toBe('rA');

    expect(h.events.countOf('trip.rider.accepted')).toBe(1);
    expect(h.events.countOf('trip.rider.assigned')).toBe(1);
    expect(h.scheduler.hasPending(h.trip.id)).toBe(false);
  });

  it('ignores a decision from a rider that was never offered the trip', async () => {
    const h = await createHarness({
      pickup: PICKUP,
      riders: [nearbyRider('rA', NEAR_A, PICKUP.longitude)],
      snapshots: [eligibleSnapshot('rA')],
    });
    await h.engine.startMatching(h.trip.id);

    await h.engine.submitRiderDecision(h.trip.id, 'stranger', true);

    const trip = await h.tripRepository.findById(h.trip.id);
    expect(trip?.status).toBe('SEARCHING_RIDER');
    expect(h.events.countOf('trip.rider.assigned')).toBe(0);
  });

  it('advances to the next batch after all offered riders reject', async () => {
    const h = await createHarness({
      pickup: PICKUP,
      riders: [
        nearbyRider('rA', NEAR_A, PICKUP.longitude),
        nearbyRider('rB', NEAR_B, PICKUP.longitude),
        nearbyRider('rC', NEAR_C, PICKUP.longitude),
      ],
      snapshots: [eligibleSnapshot('rA'), eligibleSnapshot('rB'), eligibleSnapshot('rC')],
      config: { batchSize: 2 },
    });
    await h.engine.startMatching(h.trip.id);

    await h.engine.submitRiderDecision(h.trip.id, 'rA', false);
    await h.engine.submitRiderDecision(h.trip.id, 'rB', false);

    expect(h.events.countOf('trip.rider.rejected')).toBe(2);
    const notified = h.events.events
      .filter((event) => event.topic === 'trip.rider.notified')
      .map((event) => event.payload.riderId);
    expect(notified).toEqual(['rA', 'rB', 'rC']);
  });

  it('does not assign the same rider to two trips (shared reservation + binding)', async () => {
    const lock = new InMemoryDistributedLock();
    const dispatchStore = new MemoryDispatchStore();
    const shared = [nearbyRider('shared', NEAR_A, PICKUP.longitude)];
    const snapshots = [eligibleSnapshot('shared')];

    // Both workers share the lock and dispatch store, mirroring shared Redis in
    // production: the reservation prevents a duplicate offer and the durable
    // binding prevents a duplicate assignment.
    const h1 = await createHarness({
      lock,
      dispatchStore,
      pickup: PICKUP,
      riders: shared,
      snapshots,
    });
    const h2 = await createHarness({
      lock,
      dispatchStore,
      pickup: PICKUP,
      riders: shared,
      snapshots,
    });

    await h1.engine.startMatching(h1.trip.id);
    await h2.engine.startMatching(h2.trip.id);

    await h1.engine.submitRiderDecision(h1.trip.id, 'shared', true);
    await h2.engine.submitRiderDecision(h2.trip.id, 'shared', true);

    const trip1 = await h1.tripRepository.findById(h1.trip.id);
    const trip2 = await h2.tripRepository.findById(h2.trip.id);
    const assignedCount = [trip1?.riderId, trip2?.riderId].filter((id) => id === 'shared').length;
    expect(assignedCount).toBe(1);
  });
});

describe('MatchingEngine timeout and cancellation', () => {
  it('advances to the next batch when the dispatch window times out', async () => {
    const h = await createHarness({
      pickup: PICKUP,
      riders: [
        nearbyRider('rA', NEAR_A, PICKUP.longitude),
        nearbyRider('rB', NEAR_B, PICKUP.longitude),
        nearbyRider('rC', NEAR_C, PICKUP.longitude),
      ],
      snapshots: [eligibleSnapshot('rA'), eligibleSnapshot('rB'), eligibleSnapshot('rC')],
      config: { batchSize: 2 },
    });
    await h.engine.startMatching(h.trip.id);
    expect(h.scheduler.hasPending(h.trip.id)).toBe(true);

    await h.scheduler.runDue(h.trip.id);

    const notified = h.events.events
      .filter((event) => event.topic === 'trip.rider.notified')
      .map((event) => event.payload.riderId);
    expect(notified).toContain('rC');
  });

  it('cancels matching and releases reservations on trip cancellation', async () => {
    const h = await createHarness({
      pickup: PICKUP,
      riders: [nearbyRider('rA', NEAR_A, PICKUP.longitude)],
      snapshots: [eligibleSnapshot('rA')],
    });
    await h.engine.startMatching(h.trip.id);

    await h.engine.cancelMatching(h.trip.id);

    const session = await h.sessionRepository.findByTripId(h.trip.id);
    expect(session?.status).toBe('CANCELLED');
    expect(h.scheduler.hasPending(h.trip.id)).toBe(false);
    expect(await h.dispatchStore.getOfferedRiders(h.trip.id)).toHaveLength(0);
  });
});
