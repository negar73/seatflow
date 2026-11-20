/**
 * GET /api/bookings/[id]
 *
 * Single booking with its seats — the endpoint the booking page polls every
 * 2 seconds while payment is PENDING. Returns the full current state
 * (PENDING / CONFIRMED / FAILED) plus the failure reason when applicable.
 */

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { BookingNotFoundError } from "@/lib/errors";
import { errorResponse } from "@/lib/http";
import { bookingInclude } from "@/lib/reservation";
import { toBookingDto } from "@/lib/serializers";
import type { BookingDto } from "@/types/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const booking = await db.booking.findUnique({
      where: { id },
      include: bookingInclude,
    });

    if (!booking) throw new BookingNotFoundError(id);

    const payload: BookingDto = toBookingDto(booking);
    return NextResponse.json(payload);
  } catch (error) {
    return errorResponse(error);
  }
}
