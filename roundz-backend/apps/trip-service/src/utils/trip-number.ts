import { randomBytes } from 'node:crypto';

/**
 * Generates a human-friendly, collision-resistant trip number. Uniqueness is
 * ultimately enforced by the `tripNumber` unique constraint; the service retries
 * generation on the rare conflict.
 */
export function generateTripNumber(now: Date = new Date()): string {
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = randomBytes(4).toString('hex').toUpperCase();
  return `TRP-${datePart}-${randomPart}`;
}
