import type { TripVehicleType } from '@prisma/client';
import type { RiderEligibilitySnapshot } from './matching-types';

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: EligibilityFailureReason };

export type EligibilityFailureReason =
  | 'NOT_ACTIVE'
  | 'NOT_APPROVED'
  | 'NOT_ONLINE'
  | 'BUSY'
  | 'NO_PRIMARY_VEHICLE'
  | 'VEHICLE_TYPE_MISMATCH'
  | 'NO_CURRENT_LOCATION'
  | 'HAS_ACTIVE_TRIP';

/**
 * Pure eligibility gate. A rider must satisfy every rule to be dispatched to.
 * Kept side-effect free so it can be unit tested and reused by any strategy or
 * caller without pulling in persistence or transport concerns.
 */
export function evaluateEligibility(
  snapshot: RiderEligibilitySnapshot,
  requestedVehicleType: TripVehicleType,
): EligibilityResult {
  if (snapshot.status !== 'ACTIVE') {
    return { eligible: false, reason: 'NOT_ACTIVE' };
  }
  if (snapshot.approvalStatus !== 'APPROVED') {
    return { eligible: false, reason: 'NOT_APPROVED' };
  }
  if (snapshot.onlineStatus !== 'ONLINE') {
    return { eligible: false, reason: 'NOT_ONLINE' };
  }
  if (snapshot.isBusy) {
    return { eligible: false, reason: 'BUSY' };
  }
  if (!snapshot.primaryVehicleType) {
    return { eligible: false, reason: 'NO_PRIMARY_VEHICLE' };
  }
  if (snapshot.primaryVehicleType !== requestedVehicleType) {
    return { eligible: false, reason: 'VEHICLE_TYPE_MISMATCH' };
  }
  if (!snapshot.hasCurrentLocation) {
    return { eligible: false, reason: 'NO_CURRENT_LOCATION' };
  }
  if (snapshot.hasActiveTrip) {
    return { eligible: false, reason: 'HAS_ACTIVE_TRIP' };
  }

  return { eligible: true };
}

export function isRiderEligible(
  snapshot: RiderEligibilitySnapshot,
  requestedVehicleType: TripVehicleType,
): boolean {
  return evaluateEligibility(snapshot, requestedVehicleType).eligible;
}
