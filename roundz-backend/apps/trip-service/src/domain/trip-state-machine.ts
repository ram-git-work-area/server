import { AppError } from '@roundz/errors';

export const TRIP_STATUSES = [
  'REQUESTED',
  'SEARCHING_RIDER',
  'RIDER_ASSIGNED',
  'RIDER_ARRIVING',
  'OTP_PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;

export type TripStatusValue = (typeof TRIP_STATUSES)[number];

/**
 * Allowed forward transitions for each state. Kept as a pure data structure so
 * new states/edges can be added later without touching service or transport
 * code. Terminal states have no outgoing transitions.
 */
const TRANSITIONS: Record<TripStatusValue, readonly TripStatusValue[]> = {
  REQUESTED: ['SEARCHING_RIDER', 'CANCELLED', 'FAILED'],
  SEARCHING_RIDER: ['RIDER_ASSIGNED', 'CANCELLED', 'FAILED'],
  RIDER_ASSIGNED: ['RIDER_ARRIVING', 'CANCELLED', 'FAILED'],
  RIDER_ARRIVING: ['OTP_PENDING', 'CANCELLED', 'FAILED'],
  OTP_PENDING: ['IN_PROGRESS', 'CANCELLED', 'FAILED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED', 'FAILED'],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
};

export const TERMINAL_TRIP_STATUSES: readonly TripStatusValue[] = [
  'COMPLETED',
  'CANCELLED',
  'FAILED',
];

export const ACTIVE_TRIP_STATUSES: readonly TripStatusValue[] = TRIP_STATUSES.filter(
  (status) => !TERMINAL_TRIP_STATUSES.includes(status),
);

/** States from which a customer is allowed to cancel their own trip. */
export const CUSTOMER_CANCELLABLE_STATUSES: readonly TripStatusValue[] = [
  'REQUESTED',
  'SEARCHING_RIDER',
  'RIDER_ASSIGNED',
  'RIDER_ARRIVING',
  'OTP_PENDING',
];

export function allowedTransitions(from: TripStatusValue): readonly TripStatusValue[] {
  return TRANSITIONS[from];
}

export function canTransition(from: TripStatusValue, to: TripStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: TripStatusValue): boolean {
  return TERMINAL_TRIP_STATUSES.includes(status);
}

export function isActiveStatus(status: TripStatusValue): boolean {
  return !isTerminalStatus(status);
}

export function assertTransition(from: TripStatusValue, to: TripStatusValue): void {
  if (from === to) {
    throw new AppError(`Trip is already in status ${to}`, 409, 'TRIP_INVALID_TRANSITION', {
      from,
      to,
    });
  }

  if (!canTransition(from, to)) {
    throw new AppError(
      `Invalid trip status transition from ${from} to ${to}`,
      409,
      'TRIP_INVALID_TRANSITION',
      { from, to, allowed: allowedTransitions(from) },
    );
  }
}
