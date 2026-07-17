import { describe, expect, it } from 'vitest';
import {
  ACTIVE_TRIP_STATUSES,
  assertTransition,
  canTransition,
  isActiveStatus,
  isTerminalStatus,
} from '../src/domain/trip-state-machine';

describe('trip state machine', () => {
  it('allows valid forward transitions', () => {
    expect(canTransition('REQUESTED', 'SEARCHING_RIDER')).toBe(true);
    expect(canTransition('SEARCHING_RIDER', 'RIDER_ASSIGNED')).toBe(true);
    expect(canTransition('RIDER_ASSIGNED', 'RIDER_ARRIVING')).toBe(true);
    expect(canTransition('RIDER_ARRIVING', 'OTP_PENDING')).toBe(true);
    expect(canTransition('OTP_PENDING', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
  });

  it('allows cancellation and failure from active states', () => {
    expect(canTransition('REQUESTED', 'CANCELLED')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'FAILED')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition('REQUESTED', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('REQUESTED', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
  });

  it('treats terminal states as terminal with no outgoing transitions', () => {
    expect(isTerminalStatus('COMPLETED')).toBe(true);
    expect(isTerminalStatus('CANCELLED')).toBe(true);
    expect(isTerminalStatus('FAILED')).toBe(true);
    expect(canTransition('CANCELLED', 'REQUESTED')).toBe(false);
  });

  it('classifies active statuses', () => {
    expect(isActiveStatus('REQUESTED')).toBe(true);
    expect(isActiveStatus('COMPLETED')).toBe(false);
    expect(ACTIVE_TRIP_STATUSES).not.toContain('COMPLETED');
    expect(ACTIVE_TRIP_STATUSES).toContain('SEARCHING_RIDER');
  });

  it('throws on invalid transition and on same-state transition', () => {
    expect(() => assertTransition('REQUESTED', 'COMPLETED')).toThrowError();
    expect(() => assertTransition('REQUESTED', 'REQUESTED')).toThrowError();
    expect(() => assertTransition('REQUESTED', 'SEARCHING_RIDER')).not.toThrow();
  });
});
