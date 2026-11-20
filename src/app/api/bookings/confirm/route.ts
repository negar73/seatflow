/**
 * POST /api/bookings/confirm
 *
 * Turns a live hold into a PENDING booking and enqueues payment processing.
 *
 * Idempotency: the key travels in the `Idempotency-Key` header (canonical)
 * or in the body (`idempotencyKey`). Replays return the original booking
 * with 200 instead of creating a second one; 201 is reserved for the first
 * successful creation.
 *
 * Errors:
 *   400 VALIDATION_ERROR / missing idempotency key
 *   409 HOLD_INVALID / IDEMPOTENCY_CONFLICT
 *   410 HOLD_EXPIRED
 *   503 PAYMENT_QUEUE_UNAVAILABLE (booking already compensated to FAILED)
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { errorResponse, parseJsonBody } from "@/lib/http";
import { confirmBooking } from "@/lib/reservation";
import { toBookingDto } from "@/lib/serializers";
import { confirmRequestSchema } from "@/lib/validation";
import type { BookingDto } from "@/types/api";

const idempotencyKeyHeaderSchema = z.string().min(8).max(64);

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request, confirmRequestSchema);

    // Canonical idempotency transport is the header; body field as fallback.
    const rawHeaderKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (rawHeaderKey.length > 0) {
      const parsedHeader = idempotencyKeyHeaderSchema.safeParse(rawHeaderKey);
      if (!parsedHeader.success) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Idempotency-Key header must be 8–64 characters.",
          400,
        );
      }
    }

    const idempotencyKey =
      rawHeaderKey.length > 0 ? rawHeaderKey : body.idempotencyKey;
    if (!idempotencyKey) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Missing idempotency key: send the Idempotency-Key header or an idempotencyKey body field.",
        400,
      );
    }

    const { booking, replay } = await confirmBooking({
      holdToken: body.holdToken,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      idempotencyKey,
    });

    const payload: BookingDto = toBookingDto(booking);

    // 200 for a replayed booking, 201 when we just created it.
    return NextResponse.json(payload, { status: replay ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
