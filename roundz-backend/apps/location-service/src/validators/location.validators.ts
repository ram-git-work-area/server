import { AppError } from '@roundz/errors';
import { haversineMeters } from '../utils/geo';

export function assertValidCoordinates(latitude: number, longitude: number) {
  if (
    Number.isNaN(latitude) ||
    Number.isNaN(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new AppError('Invalid coordinates', 400, 'LOCATION_INVALID_COORDINATES');
  }
}

export function assertPlausibleReportedSpeed(
  speed: number | null | undefined,
  maxSpeedMps: number,
) {
  if (speed != null && speed > maxSpeedMps) {
    throw new AppError(
      'Reported speed exceeds allowed threshold',
      422,
      'LOCATION_IMPOSSIBLE_SPEED',
    );
  }
}

/**
 * Guards against GPS "teleports": if the implied speed between the previous and
 * the new fix exceeds the configured threshold, the update is rejected. Returns
 * silently when there is no prior fix or the time delta is non-positive.
 */
export function assertPlausibleImpliedSpeed(
  previous: { latitude: number; longitude: number; lastUpdatedAt: Date } | null,
  next: { latitude: number; longitude: number; timestamp: Date },
  maxSpeedMps: number,
) {
  if (!previous) {
    return;
  }

  const deltaSeconds = (next.timestamp.getTime() - previous.lastUpdatedAt.getTime()) / 1000;
  if (deltaSeconds <= 0) {
    return;
  }

  const distance = haversineMeters(
    previous.latitude,
    previous.longitude,
    next.latitude,
    next.longitude,
  );
  const impliedSpeed = distance / deltaSeconds;

  if (impliedSpeed > maxSpeedMps) {
    throw new AppError('Implied speed exceeds allowed threshold', 422, 'LOCATION_IMPOSSIBLE_SPEED');
  }
}
