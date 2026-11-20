/**
 * Shared API contract between the REST layer and the browser client.
 * Mirrors src/lib/serializers.ts — keep both in sync.
 */

export type SeatStatusDto = "AVAILABLE" | "HELD" | "BOOKED";

export type BookingStatusDto = "PENDING" | "CONFIRMED" | "FAILED" | "CANCELLED";

export interface SeatDto {
  id: string;
  section: string;
  row: number;
  seatNumber: number;
  priceCents: number;
  status: SeatStatusDto;
}

export interface EventSummaryDto {
  id: string;
  title: string;
  description: string;
  venue: string;
  /** ISO 8601 timestamp */
  startsAt: string;
  posterEmoji: string;
  priceFromCents: number;
  totalSeats: number;
  availableSeats: number;
}

export interface EventDetailDto {
  event: {
    id: string;
    title: string;
    description: string;
    venue: string;
    startsAt: string;
    posterEmoji: string;
  };
  summary: {
    priceFromCents: number;
    totalSeats: number;
    availableSeats: number;
    heldSeats: number;
    bookedSeats: number;
  };
  sections: {
    name: string;
    rows: {
      row: number;
      seats: SeatDto[];
    }[];
  }[];
  /** The hold TTL as configured server-side, so the UI never hardcodes it. */
  holdDurationSeconds: number;
}

export interface HoldDto {
  holdToken: string;
  eventId: string;
  eventTitle: string;
  /** ISO 8601 timestamp — the moment the hold expires */
  expiresAt: string;
  seats: SeatDto[];
  totalCents: number;
}

export interface BookingDto {
  id: string;
  eventId: string;
  eventTitle: string;
  status: BookingStatusDto;
  customerName: string;
  customerEmail: string;
  totalCents: number;
  failureReason: string | null;
  createdAt: string;
  seats: SeatDto[];
}

/** Error envelope returned by every API route on failure. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
