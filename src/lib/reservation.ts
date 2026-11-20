/**
 * ============================================================================
 * SeatFlow reservation engine — the heart of the project.
 * ============================================================================
 *
 * This module implements the concurrency-safe booking lifecycle:
 *
 *   AVAILABLE ──holdSeats()──► HELD (5 min TTL) ──confirmBooking()──► BOOKED
 *                                   │                                    ▲
 *                                   │ TTL expires / payment fails        │
 *                                   └────────── released ────────────────┘
 *
 * Three mechanisms work together to make double-booking impossible:
 *
 * 1. PESSIMISTIC ROW LOCKING
 *    Every state transition starts with `SELECT … FOR UPDATE`, which takes
 *    row-level write locks in PostgreSQL. If two users try to hold the same
 *    seat simultaneously, the second transaction *blocks* on the lock until
 *    the first commits — then re-reads the row and sees status = HELD.
 *    The check-then-act sequence is therefore atomic. We never rely on
 *    optimistic retries, and we never trust a stale read.
 *    (Locks are acquired in deterministic `ORDER BY id` order so concurrent
 *    transactions on overlapping seat sets cannot deadlock.)
 *
 * 2. HOLD TTL (5 minutes)
 *    A hold is a lease, not a reservation. Every hold gets `held_until`,
 *    and seats are reclaimed by three independent safety nets:
 *      a) a BullMQ delayed job scheduled the moment the hold is created,
 *      b) `releaseExpiredHolds()` — a cron-safe bulk sweep (API endpoint),
 *      c) a lazy sweep executed when the seat map is fetched, so the UI
 *         self-heals even if the worker is down.
 *
 * 3. IDEMPOTENCY KEYS
 *    Checkout is the one operation that must never run twice (double charge,
 *    double booking). The client generates one key per checkout and sends it
 *    on every retry; the server returns the original booking for any replay.
 */

import { nanoid } from "nanoid";
import { Prisma } from "@prisma/client";

import {
  HOLD_DURATION_MS,
  MAX_SEATS_PER_HOLD,
  PAYMENT_BACKOFF_BASE_MS,
  PAYMENT_MAX_ATTEMPTS,
} from "@/lib/constants";
import { db } from "@/lib/db";
import {
  AppError,
  EventNotFoundError,
  HoldExpiredError,
  HoldInvalidError,
  IdempotencyConflictError,
  PaymentQueueUnavailableError,
  SeatNotFoundError,
  SeatsUnavailableError,
} from "@/lib/errors";
import { getHoldExpiryQueue, getPaymentQueue } from "@/lib/queue";
import { toSeatDto } from "@/lib/serializers";
import type { SeatDto } from "@/types/api";

// ---------------------------------------------------------------------------
// Tunables (single source of truth: src/lib/constants.ts)
// ---------------------------------------------------------------------------

/**
 * The delayed release job fires slightly *after* the hold TTL. The 5-second
 * buffer absorbs small clock skew between the app server, PostgreSQL and
 * Redis — releasing a hold a few seconds late is harmless; releasing it a
 * few seconds early would steal seats from a user mid-checkout.
 */
const HOLD_EXPIRY_JOB_DELAY_MS = HOLD_DURATION_MS + 5_000;

// ---------------------------------------------------------------------------
// Raw row shape returned by the locking SELECTs (snake_case on purpose —
// Prisma columns are mapped to snake_case in schema.prisma).
// ---------------------------------------------------------------------------

interface LockedSeatRow {
  id: string;
  status: string; // Postgres enum arrives as a plain string
  price_cents: number;
  held_until: Date | null;
  hold_token: string | null;
  event_id: string;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of a successful `holdSeats()` call. */
export interface SeatHold {
  holdToken: string;
  eventId: string;
  eventTitle: string;
  expiresAt: Date;
  seats: SeatDto[];
  totalCents: number;
}

/** Prisma Booking with everything the API needs to render it. */
export const bookingInclude = {
  event: { select: { title: true } },
  seats: {
    include: {
      seat: { select: { id: true, section: true, row: true, seatNumber: true } },
    },
  },
} satisfies Prisma.BookingInclude;

export type BookingWithDetails = Prisma.BookingGetPayload<{
  include: typeof bookingInclude;
}>;

export interface ConfirmBookingInput {
  holdToken: string;
  customerName: string;
  customerEmail: string;
  idempotencyKey: string;
}

export interface ConfirmBookingResult {
  booking: BookingWithDetails;
  /** True when this request was an idempotent replay of an earlier one. */
  replay: boolean;
}

// ---------------------------------------------------------------------------
// holdSeats — AVAILABLE → HELD
// ---------------------------------------------------------------------------

/**
 * Place a 5-minute hold on a set of seats for an event.
 *
 * Runs inside a single PostgreSQL transaction:
 *   1. Lock all selected seat rows with `SELECT … FOR UPDATE`.
 *   2. Verify every seat is AVAILABLE (post-lock — no stale reads).
 *   3. Flip them to HELD with a fresh, unguessable hold token + TTL.
 *
 * If any seat is unavailable, the transaction rolls back and *nothing* is
 * held — the caller gets a typed 409 error listing the offending seat ids.
 */
export async function holdSeats(input: {
  eventId: string;
  seatIds: string[];
}): Promise<SeatHold> {
  // De-duplicate defensively — the zod layer already bounds the count.
  const seatIds = [...new Set(input.seatIds)];

  if (seatIds.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Select at least one seat.",
      400,
    );
  }
  if (seatIds.length > MAX_SEATS_PER_HOLD) {
    throw new AppError(
      "VALIDATION_ERROR",
      `You can hold up to ${MAX_SEATS_PER_HOLD} seats at a time.`,
      400,
    );
  }

  // Opportunistic self-healing: reclaim long-expired holds before checking
  // availability. Without this, seats could look "taken" forever whenever
  // both the worker and the cron sweep are offline.
  await releaseExpiredHolds().catch((error) => {
    console.warn("[reservation] opportunistic sweep failed:", error);
  });

  const hold = await db.$transaction(
    async (tx) => {
      const event = await tx.event.findUnique({
        where: { id: input.eventId },
        select: { id: true, title: true },
      });
      if (!event) throw new EventNotFoundError(input.eventId);

      // --- THE critical section ------------------------------------------
      // `FOR UPDATE` takes a write lock on each matching row. Any concurrent
      // transaction selecting the same rows FOR UPDATE blocks here until we
      // commit or roll back. Under READ COMMITTED the lock acquisition also
      // re-reads the *latest committed* row version, so the status we check
      // below can never be a stale snapshot. Deterministic ORDER BY id makes
      // lock acquisition order identical across concurrent holds — the
      // textbook deadlock-prevention trick.
      const locked = await tx.$queryRaw<LockedSeatRow[]>(
        Prisma.sql`
          SELECT id, status, price_cents
          FROM "Seat"
          WHERE id IN (${Prisma.join(seatIds)}) AND event_id = ${input.eventId}
          ORDER BY id
          FOR UPDATE
        `,
      );

      // Every requested seat must exist AND belong to this event.
      if (locked.length !== seatIds.length) {
        throw new SeatNotFoundError(seatIds);
      }

      // Post-lock validation: with the rows locked, this check is race-free.
      const taken = locked
        .filter((row) => row.status !== "AVAILABLE")
        .map((row) => row.id);
      if (taken.length > 0) {
        throw new SeatsUnavailableError(taken);
      }

      const now = new Date();
      const heldUntil = new Date(now.getTime() + HOLD_DURATION_MS);
      const holdToken = nanoid(32);

      await tx.seat.updateMany({
        where: { id: { in: seatIds } },
        data: { status: "HELD", heldUntil, holdToken },
      });

      const seats = await tx.seat.findMany({
        where: { id: { in: seatIds } },
        orderBy: [{ section: "asc" }, { row: "asc" }, { seatNumber: "asc" }],
      });

      return {
        holdToken,
        eventId: event.id,
        eventTitle: event.title,
        expiresAt: heldUntil,
        seats: seats.map(toSeatDto),
        totalCents: seats.reduce((sum, seat) => sum + seat.priceCents, 0),
      } satisfies SeatHold;
    },
    {
      // Postgres default isolation. Stated explicitly because the safety of
      // the pattern above *depends* on how FOR UPDATE behaves under it.
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 15_000,
    },
  );

  // Post-commit: schedule the delayed release job. If Redis happens to be
  // down the hold still stands — safety nets (b) and (c) will reclaim the
  // seats, so this failure is logged and swallowed on purpose.
  try {
    await scheduleHoldExpiry(hold.holdToken);
  } catch (error) {
    console.warn(
      `[reservation] could not schedule expiry job for hold ${hold.holdToken} (cron/API sweep will cover it):`,
      error,
    );
  }

  return hold;
}

// ---------------------------------------------------------------------------
// confirmBooking — HELD → BOOKED (+ PENDING payment)
// ---------------------------------------------------------------------------

/**
 * Convert a hold into a booking and kick off asynchronous payment.
 *
 * Idempotent by design: presenting the same `idempotencyKey` always returns
 * the original booking — whether the first request is still in flight, has
 * succeeded, or is retried hours later. Different data under the same key
 * is rejected as a conflict (409) instead of silently returning the wrong
 * booking.
 *
 * Payment is *asynchronous on purpose*: the transaction only records intent
 * (Booking PENDING + seats BOOKED) and enqueues a BullMQ job. The checkout
 * response stays fast and the gateway latency (or its outage) never holds
 * row locks open.
 */
export async function confirmBooking(
  input: ConfirmBookingInput,
): Promise<ConfirmBookingResult> {
  // Fast path: idempotent replay with no transaction at all. This covers
  // the common retry (network hiccup after a successful confirm) cheaply.
  const replay = await findBookingByIdempotencyKey(input.idempotencyKey);
  if (replay) {
    assertKeyBelongsToHold(replay, input.holdToken);
    return { booking: replay, replay: true };
  }

  const bookingResult = await db.$transaction(
    async (tx) => {
      // Re-lock the seats owned by this hold token. The WHERE clause doubles
      // as ownership proof: released/confirmed seats no longer carry the
      // token, so they can never match again.
      const locked = await tx.$queryRaw<LockedSeatRow[]>(
        Prisma.sql`
          SELECT id, status, price_cents, held_until, event_id
          FROM "Seat"
          WHERE hold_token = ${input.holdToken}
          ORDER BY id
          FOR UPDATE
        `,
      );

      // A twin request with the same idempotency key may have committed while
      // we waited on the locks. In that case its booking *is* our answer —
      // even though the seats have already moved on to BOOKED.
      const existing = await tx.booking.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: bookingInclude,
      });
      if (existing) {
        assertKeyBelongsToHold(existing, input.holdToken);
        return { booking: existing, replay: true };
      }

      if (locked.length === 0) throw new HoldInvalidError();

      const now = new Date();

      // TTL check: a hold is only redeemable within its lease window.
      const expired = locked.some(
        (row) => row.held_until !== null && row.held_until.getTime() <= now.getTime(),
      );
      if (expired) throw new HoldExpiredError();

      // Defensive status check — with the WHERE clause above this "can't"
      // happen, but guarding invariants cheaply is what makes this engine
      // trustworthy.
      if (locked.some((row) => row.status !== "HELD")) {
        throw new HoldInvalidError();
      }

      const totalCents = locked.reduce((sum, row) => sum + row.price_cents, 0);
      const eventId = locked[0].event_id;

      const created = await tx.booking.create({
        data: {
          eventId,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          status: "PENDING",
          totalCents,
          idempotencyKey: input.idempotencyKey,
          holdToken: input.holdToken,
        },
        include: bookingInclude,
      });

      // Snapshot the price per seat: future price changes must never mutate
      // what this customer agreed to pay.
      await tx.bookingSeat.createMany({
        data: locked.map((row) => ({
          bookingId: created.id,
          seatId: row.id,
          priceCents: row.price_cents,
        })),
      });

      // Consume the hold: seats become BOOKED and stop carrying the token.
      await tx.seat.updateMany({
        where: { id: { in: locked.map((row) => row.id) } },
        data: { status: "BOOKED", holdToken: null, heldUntil: null },
      });

      return { booking: created, replay: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 15_000,
    },
  );

  // Post-commit: hand the booking to the payment worker.
  //
  // If Redis is unreachable the booking must NOT linger as PENDING forever —
  // it would keep seats locked from every other buyer. We compensate: mark
  // the booking FAILED and release its seats, then surface a 503 to the
  // client (whose idempotency key stays usable for a clean retry).
  try {
    await enqueuePaymentJob(bookingResult.booking.id);
  } catch (error) {
    await failBookingAndReleaseSeats(
      bookingResult.booking.id,
      "Payment service temporarily unreachable — seats were released automatically.",
    ).catch((compensationError) => {
      console.error(
        `[reservation] compensation failed for booking ${bookingResult.booking.id}:`,
        compensationError,
      );
    });
    throw new PaymentQueueUnavailableError(error);
  }

  return bookingResult;
}

// ---------------------------------------------------------------------------
// Hold release / expiry — HELD → AVAILABLE
// ---------------------------------------------------------------------------

/**
 * Bulk-reclaim every seat whose hold TTL has passed.
 *
 * Used by:
 *   - POST /api/bookings/release-expired (cron-safe cleanup endpoint)
 *   - the lazy sweep on seat-map fetch and before every hold attempt
 *
 * Safe to run concurrently with anything: the UPDATE takes its own row locks
 * and only touches rows that are HELD *and* expired.
 */
export async function releaseExpiredHolds(): Promise<number> {
  const result = await db.seat.updateMany({
    where: { status: "HELD", heldUntil: { lt: new Date() } },
    data: { status: "AVAILABLE", holdToken: null, heldUntil: null },
  });
  return result.count;
}

/**
 * Release the seats of one specific hold token.
 *
 * Called by the BullMQ delayed job scheduled at hold time. The token filter
 * makes this a no-op for holds that were already confirmed (their seats no
 * longer carry the token) — idempotent by construction.
 *
 * Note: no `held_until` predicate here. The job is scheduled TTL + 5s, and
 * if it runs marginally early (clock skew) we still want the seats back
 * rather than stranded until the next sweep.
 */
export async function releaseHoldByToken(holdToken: string): Promise<number> {
  const result = await db.seat.updateMany({
    where: { status: "HELD", holdToken },
    data: { status: "AVAILABLE", holdToken: null, heldUntil: null },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Payment failure compensation — used by the worker
// ---------------------------------------------------------------------------

/**
 * Terminal payment failure: mark the booking FAILED and hand its seats back
 * to inventory.
 *
 * The `status = PENDING` guard inside the same transaction is the
 * compensation safety net: if the payment somehow succeeded afterwards
 * (late retry, duplicate delivery), the booking is already CONFIRMED, the
 * guard matches zero rows and the seats stay sold.
 */
export async function failBookingAndReleaseSeats(
  bookingId: string,
  reason: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    // Atomic guard — only a still-pending booking may be failed.
    const updated = await tx.booking.updateMany({
      where: { id: bookingId, status: "PENDING" },
      data: { status: "FAILED", failureReason: reason.slice(0, 300) },
    });
    if (updated.count === 0) return; // already CONFIRMED/FAILED — do nothing

    const seatIds = (
      await tx.bookingSeat.findMany({
        where: { bookingId },
        select: { seatId: true },
      })
    ).map((row) => row.seatId);

    if (seatIds.length > 0) {
      await tx.seat.updateMany({
        where: { id: { in: seatIds }, status: "BOOKED" },
        data: { status: "AVAILABLE", holdToken: null, heldUntil: null },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Replay lookup used by the idempotency fast path. */
async function findBookingByIdempotencyKey(
  idempotencyKey: string,
): Promise<BookingWithDetails | null> {
  return db.booking.findUnique({
    where: { idempotencyKey },
    include: bookingInclude,
  });
}

/** Same key + different hold payload is a client bug, not a replay. */
function assertKeyBelongsToHold(
  booking: BookingWithDetails,
  holdToken: string,
): void {
  if (booking.holdToken && booking.holdToken !== holdToken) {
    throw new IdempotencyConflictError();
  }
}

/** Schedule the delayed "release this hold" job (fire-and-forget producer). */
async function scheduleHoldExpiry(holdToken: string): Promise<void> {
  await getHoldExpiryQueue().add(
    "release-hold",
    { holdToken },
    {
      delay: HOLD_EXPIRY_JOB_DELAY_MS,
      attempts: 3,
      backoff: { type: "fixed", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  );
}

/** Enqueue the payment job with the retry/backoff policy attached. */
async function enqueuePaymentJob(bookingId: string): Promise<void> {
  await getPaymentQueue().add(
    "process-payment",
    { bookingId },
    {
      attempts: PAYMENT_MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: PAYMENT_BACKOFF_BASE_MS },
      // Keep some history for observability; failed jobs are never removed
      // so they can be inspected / re-run manually.
      removeOnComplete: { count: 500 },
      removeOnFail: false,
    },
  );
}
