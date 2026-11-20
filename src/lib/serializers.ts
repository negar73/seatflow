/**
 * Serializers: Prisma models → plain JSON DTOs.
 *
 * Keeping an explicit API contract (instead of leaking Prisma entities)
 * means Date objects become ISO strings in a controlled way and the client
 * types in src/types/api.ts always match what the routes actually emit.
 */

import type { Booking, Seat } from "@prisma/client";

import type { BookingWithDetails } from "@/lib/reservation";
import type {
  BookingDto,
  BookingStatusDto,
  SeatDto,
  SeatStatusDto,
} from "@/types/api";

export function toSeatDto(seat: Seat): SeatDto {
  return {
    id: seat.id,
    section: seat.section,
    row: seat.row,
    seatNumber: seat.seatNumber,
    priceCents: seat.priceCents,
    status: seat.status as SeatStatusDto,
  };
}

export function toBookingDto(booking: BookingWithDetails): BookingDto {
  // Present seats in reading order (section → row → seat number) regardless
  // of the order they were inserted in.
  const seats = [...booking.seats]
    .sort(
      (a, b) =>
        a.seat.section.localeCompare(b.seat.section) ||
        a.seat.row - b.seat.row ||
        a.seat.seatNumber - b.seat.seatNumber,
    )
    .map((bookingSeat) => ({
      id: bookingSeat.seat.id,
      section: bookingSeat.seat.section,
      row: bookingSeat.seat.row,
      seatNumber: bookingSeat.seat.seatNumber,
      // Price snapshot from the booking, not the live seat price.
      priceCents: bookingSeat.priceCents,
      status: "BOOKED" as const,
    }));

  return {
    id: booking.id,
    eventId: booking.eventId,
    eventTitle: booking.event.title,
    status: booking.status as BookingStatusDto,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    totalCents: booking.totalCents,
    failureReason: booking.failureReason,
    createdAt: booking.createdAt.toISOString(),
    seats,
  };
}

/** Shorthand used by the seat-map endpoint when reading plain seats. */
export function seatDtos(seats: Seat[]): SeatDto[] {
  return seats.map(toSeatDto);
}

export type { Booking };
