import { describe, expect, it } from 'vitest';
import { evaluateEligibility, isRiderEligible } from '../../src/domain/matching/eligibility';
import { eligibleSnapshot } from './harness';

describe('rider eligibility', () => {
  it('accepts a fully eligible rider whose vehicle matches', () => {
    expect(isRiderEligible(eligibleSnapshot('r1'), 'CAR')).toBe(true);
  });

  it.each([
    ['NOT_ACTIVE', { status: 'SUSPENDED' }],
    ['NOT_APPROVED', { approvalStatus: 'PENDING' }],
    ['NOT_ONLINE', { onlineStatus: 'OFFLINE' }],
    ['BUSY', { isBusy: true }],
    ['NO_PRIMARY_VEHICLE', { primaryVehicleType: null }],
    ['NO_CURRENT_LOCATION', { hasCurrentLocation: false }],
    ['HAS_ACTIVE_TRIP', { hasActiveTrip: true }],
  ] as const)('rejects an ineligible rider with reason %s', (reason, overrides) => {
    const result = evaluateEligibility(eligibleSnapshot('r1', overrides), 'CAR');
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toBe(reason);
    }
  });

  it('rejects a rider whose vehicle type does not match the request', () => {
    const result = evaluateEligibility(
      eligibleSnapshot('r1', { primaryVehicleType: 'BIKE' }),
      'CAR',
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toBe('VEHICLE_TYPE_MISMATCH');
    }
  });
});
