import { describe, expect, it } from 'vitest';
import {
  HighestRatedRiderStrategy,
  HybridScoreStrategy,
  LeastBusyRiderStrategy,
  NearestRiderStrategy,
  createStrategyRegistry,
  resolveStrategy,
} from '../../src/domain/matching/strategies';
import type { RiderCandidate } from '../../src/domain/matching/matching-types';
import { emptyContext } from './harness';

function candidate(overrides: Partial<RiderCandidate> & { riderId: string }): RiderCandidate {
  return {
    distanceMeters: 1000,
    rating: 4,
    activeTripCount: 0,
    vehicleType: 'CAR',
    ...overrides,
  };
}

const candidates: RiderCandidate[] = [
  candidate({ riderId: 'far-top-rated', distanceMeters: 4000, rating: 5, activeTripCount: 3 }),
  candidate({ riderId: 'near-low-rated', distanceMeters: 500, rating: 3.5, activeTripCount: 1 }),
  candidate({ riderId: 'mid-idle', distanceMeters: 2000, rating: 4.2, activeTripCount: 0 }),
];

describe('matching strategies', () => {
  it('nearest prefers the closest rider', () => {
    const ranked = new NearestRiderStrategy().rank(candidates, emptyContext);
    expect(ranked[0]?.riderId).toBe('near-low-rated');
  });

  it('highest rated prefers the best rating', () => {
    const ranked = new HighestRatedRiderStrategy().rank(candidates, emptyContext);
    expect(ranked[0]?.riderId).toBe('far-top-rated');
  });

  it('least busy prefers the fewest active trips', () => {
    const ranked = new LeastBusyRiderStrategy().rank(candidates, emptyContext);
    expect(ranked[0]?.riderId).toBe('mid-idle');
  });

  it('hybrid balances distance, rating, and load', () => {
    const ranked = new HybridScoreStrategy().rank(candidates, emptyContext);
    expect(ranked.map((entry) => entry.riderId)).toContain('near-low-rated');
    expect(ranked).toHaveLength(3);
  });

  it('does not mutate the input array', () => {
    const input = [...candidates];
    new NearestRiderStrategy().rank(input, emptyContext);
    expect(input.map((entry) => entry.riderId)).toEqual(candidates.map((entry) => entry.riderId));
  });

  it('ranking is deterministic for equal candidates via id tie-break', () => {
    const tied = [
      candidate({ riderId: 'b', distanceMeters: 1000 }),
      candidate({ riderId: 'a', distanceMeters: 1000 }),
    ];
    const ranked = new NearestRiderStrategy().rank(tied, emptyContext);
    expect(ranked.map((entry) => entry.riderId)).toEqual(['a', 'b']);
  });

  it('registry resolves every strategy and rejects unknown names', () => {
    const registry = createStrategyRegistry();
    expect(resolveStrategy('nearest', registry).name).toBe('nearest');
    expect(resolveStrategy('hybrid', registry).name).toBe('hybrid');
    expect(() => resolveStrategy('does_not_exist' as never, registry)).toThrow();
  });
});
