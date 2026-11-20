/**
 * POST /api/events/[id]/hold
 *
 * Body: { seatIds: string[] } (1–6 seat ids)
 *
 * Places a concurrency-safe 5-minute hold. Errors:
 *   400 VALIDATION_ERROR  — malformed body / too many seats
 *   404 EVENT_NOT_FOUND   — unknown event
 *   409 SEATS_UNAVAILABLE — someone was faster; details list the seat ids
 *
 * Success returns the hold descriptor (token, expiry, seats, total) that the
 * checkout page consumes via GET /api/holds/[token].
 */

import { NextResponse } from "next/server";

import { errorResponse, parseJsonBody } from "@/lib/http";
import { holdSeats } from "@/lib/reservation";
import { holdRequestSchema } from "@/lib/validation";
import type { HoldDto } from "@/types/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await parseJsonBody(request, holdRequestSchema);

    const hold = await holdSeats({ eventId: id, seatIds: body.seatIds });

    const payload: HoldDto = {
      holdToken: hold.holdToken,
      eventId: hold.eventId,
      eventTitle: hold.eventTitle,
      expiresAt: hold.expiresAt.toISOString(),
      seats: hold.seats,
      totalCents: hold.totalCents,
    };

    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
