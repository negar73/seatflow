/**
 * Presentation helpers shared across client components.
 *
 * All formatting is deterministic (no locale-dependent output) so that the
 * same value renders identically on the server and during hydration.
 */

/** Format a minor-unit amount as euros, e.g. 12500 → "€125.00". */
export function formatPrice(cents: number): string {
  const euros = Math.floor(cents / 100);
  const remainder = cents % 100;
  const grouped = euros.toLocaleString("en-US");
  return `€${grouped}.${remainder.toString().padStart(2, "0")}`;
}

const EVENT_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/** Render an ISO timestamp as a stable UTC date string, e.g. "Fri, 14 Nov 2025, 17:30 UTC". */
export function formatEventDate(iso: string): string {
  return EVENT_DATE_FORMAT.format(new Date(iso));
}

/** mm:ss countdown label from a number of seconds. */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
