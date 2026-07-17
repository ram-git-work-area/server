import { AppError } from '@roundz/errors';
import type { MatchingStrategyName } from '@roundz/config';
import type { MatchingStrategy } from './matching-strategy';
import type { MatchingContext, RiderCandidate } from './matching-types';

/**
 * Stable comparator helper: keeps ordering deterministic by breaking ties on
 * riderId so the same input always produces the same batches across workers.
 */
function tieBreak(a: RiderCandidate, b: RiderCandidate): number {
  return a.riderId.localeCompare(b.riderId);
}

/** Default strategy: closest rider wins. */
export class NearestRiderStrategy implements MatchingStrategy {
  readonly name = 'nearest';

  rank(candidates: readonly RiderCandidate[], _context: MatchingContext): RiderCandidate[] {
    return [...candidates].sort((a, b) => a.distanceMeters - b.distanceMeters || tieBreak(a, b));
  }
}

/** Prefers higher-rated riders, using distance as a tie-breaker. */
export class HighestRatedRiderStrategy implements MatchingStrategy {
  readonly name = 'highest_rated';

  rank(candidates: readonly RiderCandidate[], _context: MatchingContext): RiderCandidate[] {
    return [...candidates].sort(
      (a, b) => b.rating - a.rating || a.distanceMeters - b.distanceMeters || tieBreak(a, b),
    );
  }
}

/** Prefers riders with the fewest active/recent trips to balance load. */
export class LeastBusyRiderStrategy implements MatchingStrategy {
  readonly name = 'least_busy';

  rank(candidates: readonly RiderCandidate[], _context: MatchingContext): RiderCandidate[] {
    return [...candidates].sort(
      (a, b) =>
        a.activeTripCount - b.activeTripCount ||
        a.distanceMeters - b.distanceMeters ||
        tieBreak(a, b),
    );
  }
}

const HYBRID_WEIGHTS = {
  distance: 0.6,
  rating: 0.25,
  load: 0.15,
} as const;

const HYBRID_DISTANCE_NORMALIZER_METERS = 10_000;
const HYBRID_LOAD_NORMALIZER = 5;

/**
 * Weighted score across distance, rating, and load. Lower score is better.
 * Weights are constants here but are the natural place to make configurable or
 * ML-driven later without touching the engine.
 */
export class HybridScoreStrategy implements MatchingStrategy {
  readonly name = 'hybrid';

  rank(candidates: readonly RiderCandidate[], _context: MatchingContext): RiderCandidate[] {
    return [...candidates]
      .map((candidate) => ({ candidate, score: this.score(candidate) }))
      .sort((a, b) => a.score - b.score || tieBreak(a.candidate, b.candidate))
      .map((entry) => entry.candidate);
  }

  private score(candidate: RiderCandidate): number {
    const distanceScore = Math.min(candidate.distanceMeters / HYBRID_DISTANCE_NORMALIZER_METERS, 1);
    const ratingScore = 1 - Math.min(Math.max(candidate.rating, 0), 5) / 5;
    const loadScore = Math.min(candidate.activeTripCount / HYBRID_LOAD_NORMALIZER, 1);

    return (
      distanceScore * HYBRID_WEIGHTS.distance +
      ratingScore * HYBRID_WEIGHTS.rating +
      loadScore * HYBRID_WEIGHTS.load
    );
  }
}

export function createStrategyRegistry(): Map<MatchingStrategyName, MatchingStrategy> {
  const strategies: MatchingStrategy[] = [
    new NearestRiderStrategy(),
    new HighestRatedRiderStrategy(),
    new LeastBusyRiderStrategy(),
    new HybridScoreStrategy(),
  ];

  return new Map(strategies.map((strategy) => [strategy.name as MatchingStrategyName, strategy]));
}

export function resolveStrategy(
  name: MatchingStrategyName,
  registry: Map<MatchingStrategyName, MatchingStrategy> = createStrategyRegistry(),
): MatchingStrategy {
  const strategy = registry.get(name);
  if (!strategy) {
    throw new AppError(`Unknown matching strategy: ${name}`, 500, 'MATCHING_STRATEGY_UNKNOWN');
  }

  return strategy;
}
