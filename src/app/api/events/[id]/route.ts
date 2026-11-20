/**
 * GET /api/events/[id]
 *
 * Everything the interactive seat map needs:
 *   - the event itself,
 *   - seats grouped into sections → rows → seats (rendering order),
 *   - a live inventory summary,
 *   - the server-configured hold TTL (so the UI never hardcodes it).
 *
 * Before reading, a best-effort expiry sweep reclaims seats whose holds have
 * lapsed. This is safety net (c) of the hold-TTL design: even with the
 * payment worker offline, the seat map self-heals the moment someone opens
 * it.
 */

import { NextResponse } from "next/server";

import { HOLD_DURATION_MS } from "@/lib/constants";
import { db } from "@/lib/db";
import { EventNotFoundError } from "@/lib/errors";
import { errorResponse } from "@/lib/http";
import { releaseExpiredHolds } from "@/lib/reservation";
import { toSeatDto } from "@/lib/serializers";
import type { EventDetailDto } from "@/types/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Lazy expiration sweep — a write piggybacking on a read, on purpose.
    await releaseExpiredHolds().catch((error) => {
      console.warn("[api/events/:id] expiry sweep failed:", error);
    });

    const event = await db.event.findUnique({
      where: { id },
      include: {
        seats: {
          orderBy: [{ section: "asc" }, { row: "asc" }, { seatNumber: "asc" }],
        },
      },
    });

    if (!event) throw new EventNotFoundError(id);

    // Group the flat seat list into the section → row hierarchy the seat map
    // renders (Section "A" row 1..n, Section "B" row 1..n …).
    const sectionsMap = new Map<string, EventDetailDto["sections"][number]>();
    for (const seat of event.seats) {
      let section = sectionsMap.get(seat.section);
      if (!section) {
        section = { name: seat.section, rows: [] };
        sectionsMap.set(seat.section, section);
      }
      let row = section.rows.find((r) => r.row === seat.row);
      if (!row) {
        row = { row: seat.row, seats: [] };
        section.rows.push(row);
      }
      row.seats.push(toSeatDto(seat));
    }

    const statuses = event.seats.map((seat) => seat.status);
    const prices = event.seats.map((seat) => seat.priceCents);

    const payload: EventDetailDto = {
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        venue: event.venue,
        startsAt: event.startsAt.toISOString(),
        posterEmoji: event.posterEmoji,
      },
      summary: {
        priceFromCents: prices.length > 0 ? Math.min(...prices) : 0,
        totalSeats: event.seats.length,
        availableSeats: statuses.filter((s) => s === "AVAILABLE").length,
        heldSeats: statuses.filter((s) => s === "HELD").length,
        bookedSeats: statuses.filter((s) => s === "BOOKED").length,
      },
      sections: [...sectionsMap.values()],
      holdDurationSeconds: Math.round(HOLD_DURATION_MS / 1000),
    };

    return NextResponse.json(payload);
  } catch (error) {
    return errorResponse(error);
  }
}
