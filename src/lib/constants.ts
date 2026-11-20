/**
 * Shared tunables for the reservation engine, the API validation layer and
 * the payment worker — one source of truth for the booking rules.
 */

/** How long a hold keeps seats reserved before they are released. */
export const HOLD_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/** Upper bound on seats per single hold (keeps transactions short). */
export const MAX_SEATS_PER_HOLD = 6;

/** Payment retry policy: 3 attempts with exponential backoff (2s → 4s → 8s). */
export const PAYMENT_MAX_ATTEMPTS = 3;
export const PAYMENT_BACKOFF_BASE_MS = 2_000;
