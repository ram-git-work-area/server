import { AppError } from '@roundz/errors';

export function assertValidCoordinates(latitude: number, longitude: number, label: string) {
  if (
    Number.isNaN(latitude) ||
    Number.isNaN(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new AppError(`Invalid ${label} coordinates`, 400, 'TRIP_INVALID_COORDINATES');
  }
}

export function assertDistinctPickupAndDrop(
  pickup: { latitude: number; longitude: number },
  drop: { latitude: number; longitude: number },
) {
  if (pickup.latitude === drop.latitude && pickup.longitude === drop.longitude) {
    throw new AppError(
      'Pickup and drop locations must be different',
      400,
      'TRIP_IDENTICAL_LOCATIONS',
    );
  }
}
