import { AppError } from '@roundz/errors';
import { validate } from '@roundz/validation';
import { apiResponseSchema } from '../../schemas/trip.schemas';
import { matchingSessionSchema } from '../../schemas/matching.schemas';
import type { MatchingEngine, MatchingRequestContext } from './matching-engine.service';

/**
 * Application-layer wrapper around the matching engine used by the internal HTTP
 * API. Keeps controllers thin and validates responses through the shared
 * envelope, mirroring the Phase 1 trip service.
 */
export class MatchingService {
  constructor(private readonly engine: MatchingEngine) {}

  async startMatching(tripId: string, ctx: MatchingRequestContext) {
    await this.engine.startMatching(tripId, ctx);
    return this.getMatching(tripId);
  }

  async getMatching(tripId: string) {
    const session = await this.engine.getSession(tripId);
    if (!session) {
      throw new AppError('No matching session for trip', 404, 'MATCHING_SESSION_NOT_FOUND', {
        tripId,
      });
    }
    return validate(apiResponseSchema(matchingSessionSchema), { data: session });
  }

  async submitDecision(
    tripId: string,
    riderId: string,
    accepted: boolean,
    ctx: MatchingRequestContext,
  ) {
    await this.engine.submitRiderDecision(tripId, riderId, accepted, ctx);
    return this.getMatching(tripId);
  }
}
