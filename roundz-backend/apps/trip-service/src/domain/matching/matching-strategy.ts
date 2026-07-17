import type { MatchingContext, RiderCandidate } from './matching-types';

/**
 * Pluggable ranking policy for candidate riders. New strategies can be added by
 * implementing this interface and registering them — no existing matching,
 * dispatch, or transport code needs to change.
 */
export interface MatchingStrategy {
  readonly name: string;
  /**
   * Returns a new array of candidates ordered from best to worst. Must be pure
   * (no mutation of the input array) so it is safe to reuse across sessions.
   */
  rank(candidates: readonly RiderCandidate[], context: MatchingContext): RiderCandidate[];
}
