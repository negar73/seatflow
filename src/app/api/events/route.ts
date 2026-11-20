/**
 * GET /api/events
 *
 * Public catalogue: every upcoming event with the stats needed for the
 * landing grid (lowest price, total/available seats). The dataset is small
 * enough that aggregation happens in memory — one query, no N+1.
 */

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import type { EventSummaryDto } from "@/types/api";

export async function GET(): Promise<NextResponse> {
  try {
    const events = await db.event.findMany({
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        venue: true,
        startsAt: true,
        posterEmoji: true,
        seats: { select: { priceCents: true, status: true } },
      },
    });

    const payload: EventSummaryDto[] = events.map((event) => {
      const prices = event.seats.map((seat) => seat.priceCents);
      return {
        id: event.id,
        title: event.title,
        description: event.description,
        venue: event.venue,
        startsAt: event.startsAt.toISOString(),
        posterEmoji: event.posterEmoji,
        priceFromCents: prices.length > 0 ? Math.min(...prices) : 0,
        totalSeats: event.seats.length,
        availableSeats: event.seats.filter((s) => s.status === "AVAILABLE").length,
      };
    });

    return NextResponse.json(payload);
  } catch (error) {
    return errorResponse(error);
  }
}
