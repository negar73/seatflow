/**
 * POST /api/bookings/release-expired
 *
 * Cron-safe maintenance endpoint that bulk-reclaims every seat whose hold
 * TTL has lapsed. This is safety net (b) of the hold-expiry design — it
 * guarantees expiry even when the worker's delayed jobs cannot fire.
 *
 * In production, point a scheduler (GitHub Actions cron, Vercel Cron,
 * Kubernetes CronJob…) at this route every minute. When CRON_SECRET is set
 * the request must carry it in the `x-cron-secret` header.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http";
import { releaseExpiredHolds } from "@/lib/reservation";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Optional shared secret — enforced only when CRON_SECRET is configured.
    const secret = process.env.CRON_SECRET;
    if (secret && secret.length > 0) {
      const provided = z.string().min(1).safeParse(
        request.headers.get("x-cron-secret") ?? "",
      );
      if (!provided.success || provided.data !== secret) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Invalid or missing x-cron-secret header.",
          401,
        );
      }
    }

    const released = await releaseExpiredHolds();
    return NextResponse.json({ released });
  } catch (error) {
    return errorResponse(error);
  }
}
