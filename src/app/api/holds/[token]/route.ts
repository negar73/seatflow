/**
 * GET /api/holds/[token]
 *
 * Hydration endpoint for the checkout page. Derives the current state of a
 * hold straight from the seats that carry the token:
 *
 *   - seats found & still HELD → live hold (seats, total, remaining TTL)
 *   - no seats with the token  → the hold was consumed (booking created) or
 *     released (expired) — the checkout shows the "hold invalid" state.
 *
 * It is intentionally read-only: the authoritative transition happens in
 * POST /api/bookings/confirm.
 */

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { HoldExpiredError, HoldInvalidError } from "@/lib/errors";
import { errorResponse } from "@/lib/http";
import { releaseExpiredHolds } from "@/lib/reservation";
import { toSeatDto } from "@/lib/serializers";
import type { HoldDto } from "@/types/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const { token } = await params;

    // Same lazy sweep as the seat map: a hold that expired a while ago is
    // reported as invalid (its seats were already released), while one that
    // lapsed seconds ago is reported as expired (seats still carry the
    // token until a sweep runs).
    await releaseExpiredHolds().catch(() => undefined);

    const seats = await db.seat.findMany({
      where: { holdToken: token, status: "HELD" },
      orderBy: [{ section: "asc" }, { row: "asc" }, { seatNumber: "asc" }],
    });

    if (seats.length === 0) {
      // Distinguish "definitely expired" (token still exists somewhere) from
      // "gone" for a friendlier checkout message.
      const stillMarked = await db.seat.count({ where: { holdToken: token } });
      if (stillMarked > 0) throw new HoldExpiredError();
      throw new HoldInvalidError();
    }

    const expiresAt = seats[0].heldUntil;
    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
      throw new HoldExpiredError();
    }

    const event = await db.event.findUniqueOrThrow({
      where: { id: seats[0].eventId },
      select: { id: true, title: true },
    });

    const payload: HoldDto = {
      holdToken: token,
      eventId: event.id,
      eventTitle: event.title,
      expiresAt: expiresAt.toISOString(),
      seats: seats.map(toSeatDto),
      totalCents: seats.reduce((sum, seat) => sum + seat.priceCents, 0),
    };

    return NextResponse.json(payload);
  } catch (error) {
    return errorResponse(error);
  }
}
