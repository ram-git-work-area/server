import { describe, expect, it } from 'vitest';
import { MatchingConsumer } from '../../src/events/matching.consumers';
import { createHarness, eligibleSnapshot, nearbyRider } from './harness';

const PICKUP = { latitude: 12.9716, longitude: 77.5946 };
const NEAR = PICKUP.latitude + 0.002;

describe('MatchingConsumer', () => {
  it('starts matching when a trip.created event arrives', async () => {
    const h = await createHarness({
      pickup: PICKUP,
      riders: [nearbyRider('rA', NEAR, PICKUP.longitude)],
      snapshots: [eligibleSnapshot('rA')],
    });
    const consumer = new MatchingConsumer(h.engine);

    await consumer.handle('trip.created', JSON.stringify({ tripId: h.trip.id, requestId: 'r1' }));

    const session = await h.sessionRepository.findByTripId(h.trip.id);
    expect(session).not.toBeNull();
    expect(h.events.countOf('trip.search.started')).toBe(1);
  });

  it('cancels matching when a trip.cancelled event arrives', async () => {
    const h = await createHarness({
      pickup: PICKUP,
      riders: [nearbyRider('rA', NEAR, PICKUP.longitude)],
      snapshots: [eligibleSnapshot('rA')],
    });
    const consumer = new MatchingConsumer(h.engine);

    await consumer.handle('trip.created', JSON.stringify({ tripId: h.trip.id }));
    await consumer.handle('trip.cancelled', JSON.stringify({ tripId: h.trip.id }));

    const session = await h.sessionRepository.findByTripId(h.trip.id);
    expect(session?.status).toBe('CANCELLED');
  });

  it('hydrates the availability cache from rider.status.changed so no Rider Service call is needed', async () => {
    // Location knows the rider, but the Rider Service client has no snapshot.
    const h = await createHarness({
      pickup: PICKUP,
      riders: [nearbyRider('cachedRider', NEAR, PICKUP.longitude)],
      snapshots: [],
    });
    const consumer = new MatchingConsumer(h.engine);

    await consumer.handle('rider.status.changed', JSON.stringify(eligibleSnapshot('cachedRider')));
    await consumer.handle('trip.created', JSON.stringify({ tripId: h.trip.id }));

    const notified = h.events.events
      .filter((event) => event.topic === 'trip.rider.notified')
      .map((event) => event.payload.riderId);
    expect(notified).toEqual(['cachedRider']);
  });

  it('ignores malformed payloads without throwing', async () => {
    const h = await createHarness();
    const consumer = new MatchingConsumer(h.engine);

    await expect(consumer.handle('trip.created', 'not-json')).resolves.toBeUndefined();
    await expect(consumer.handle('trip.created', null)).resolves.toBeUndefined();
  });

  it('processes location.updated for a known rider without error', async () => {
    const h = await createHarness();
    const consumer = new MatchingConsumer(h.engine);
    await expect(
      consumer.handle('location.updated', JSON.stringify({ riderId: 'rA' })),
    ).resolves.toBeUndefined();
  });
});
