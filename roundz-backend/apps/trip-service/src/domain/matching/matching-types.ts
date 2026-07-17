import type { TripVehicleType } from '@prisma/client';

/** Snapshot of a rider's availability used to decide eligibility. */
export type RiderEligibilitySnapshot = {
  riderId: string;
  status: string;
  approvalStatus: string;
  onlineStatus: string;
  isBusy: boolean;
  hasActiveTrip: boolean;
  primaryVehicleType: TripVehicleType | null;
  hasCurrentLocation: boolean;
  rating: number;
  activeTripCount: number;
};

/** A rider returned from the Location Service nearby search. */
export type NearbyRider = {
  riderId: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  vehicleType?: TripVehicleType | null;
  updatedAt?: string;
};

/**
 * A fully-resolved candidate: a nearby rider that passed eligibility and now
 * carries the signals matching strategies rank on.
 */
export type RiderCandidate = {
  riderId: string;
  distanceMeters: number;
  rating: number;
  activeTripCount: number;
  vehicleType: TripVehicleType;
};

/** Immutable context a strategy may use while ranking candidates. */
export type MatchingContext = {
  tripId: string;
  vehicleType: TripVehicleType;
  pickupLatitude: number;
  pickupLongitude: number;
};
