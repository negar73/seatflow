/**
 * ============================================================================
 * SeatFlow payment worker — a standalone process.
 * ============================================================================
 *
 * Runs next to the web app (`npm run worker`) and owns two BullMQ queues:
 *
 *   "payments"     — one job per confirmed checkout. Simulates a payment
 *                    gateway, retries up to 3 times with exponential backoff,
 *                    then either confirms the booking or runs the
 *                    compensation path (mark FAILED + release the seats).
 *
 *   "hold-expiry"  — delayed jobs scheduled at hold time (TTL + 5s). Each
 *                    releases the seats of one hold token if it was never
 *                    redeemed.
 *
 * Shutting down: SIGTERM/SIGINT stop fetching new jobs and wait for the
 * in-flight one to settle, so a deploy never orphans a half-processed
 * payment.
 */

import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";

import {
  PAYMENT_BACKOFF_BASE_MS,
  PAYMENT_MAX_ATTEMPTS,
} from "../src/lib/constants";
import {
  failBookingAndReleaseSeats,
  releaseHoldByToken,
} from "../src/lib/reservation";
import {
  HOLD_EXPIRY_QUEUE_NAME,
  PAYMENT_QUEUE_NAME,
} from "../src/lib/queue";

// ---------------------------------------------------------------------------
// Setup — the worker keeps its own dedicated connections (BullMQ recommends
// one connection per Worker because polling uses blocking commands).
// ---------------------------------------------------------------------------

const prisma = new PrismaClient({ log: ["warn", "error"] });

function createConnection(): IORedis {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
}

// One dedicated connection per Worker (BullMQ polls with blocking commands).
const paymentsConnection = createConnection();
const holdExpiryConnection = createConnection();

// ---------------------------------------------------------------------------
// Payment simulation
// ---------------------------------------------------------------------------

/** Percentage of payment attempts that randomly fail (mock gateway realism). */
const PAYMENT_FAILURE_RATE = 0.15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simulated card charge: ~2s of "gateway latency", then either success or a
 * random decline. Set FORCE_PAYMENT_SUCCESS=true to record a clean demo.
 */
async function chargeCardOnMockGateway(bookingId: string): Promise<void> {
  await sleep(2_000);

  const forceSuccess = process.env.FORCE_PAYMENT_SUCCESS === "true";
  if (!forceSuccess && Math.random() < PAYMENT_FAILURE_RATE) {
    throw new Error(
      `Mock gateway declined the charge for booking ${bookingId} (simulated transient failure)`,
    );
  }
}

// ---------------------------------------------------------------------------
// "payments" queue processor
// ---------------------------------------------------------------------------

interface PaymentJobData {
  bookingId: string;
}

async function processPaymentJob(
  job: Job<PaymentJobData>,
): Promise<{ bookingId: string; status: string }> {
  const { bookingId } = job.data;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true, totalCents: true },
  });

  // Unknown booking: nothing sane to retry — fail permanently.
  if (!booking) {
    throw new Error(`Booking ${bookingId} referenced by job ${job.id} not found`);
  }

  // Idempotent redelivery: a duplicate job must not re-charge a customer.
  if (booking.status === "CONFIRMED") {
    job.log("Booking already confirmed — skipping (duplicate delivery).");
    return { bookingId, status: "CONFIRMED" };
  }
  if (booking.status !== "PENDING") {
    job.log(`Booking is ${booking.status} — nothing to do.`);
    return { bookingId, status: booking.status };
  }

  // attemptsStarted is BullMQ's 1-based, incremented-at-start attempt counter.
  job.log(
    `Charging €${(booking.totalCents / 100).toFixed(2)} (attempt ${job.attemptsStarted}/${PAYMENT_MAX_ATTEMPTS})…`,
  );

  await chargeCardOnMockGateway(bookingId);

  // Guarded transition: if a late duplicate/compensation race already moved
  // the booking out of PENDING, this update matches zero rows and we do not
  // double-confirm.
  const confirmed = await prisma.booking.updateMany({
    where: { id: bookingId, status: "PENDING" },
    data: { status: "CONFIRMED" },
  });

  if (confirmed.count === 0) {
    job.log("Booking left PENDING before confirmation — payment succeeded after the fact; manual refund required.");
    return { bookingId, status: "SKIPPED_RACE" };
  }

  return { bookingId, status: "CONFIRMED" };
}

// ---------------------------------------------------------------------------
// "hold-expiry" queue processor
// ---------------------------------------------------------------------------

interface HoldExpiryJobData {
  holdToken: string;
}

async function processHoldExpiryJob(
  job: Job<HoldExpiryJobData>,
): Promise<{ released: number }> {
  const released = await releaseHoldByToken(job.data.holdToken);
  if (released > 0) {
    job.log(`Released ${released} seat(s) for expired hold.`);
  }
  return { released };
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

const paymentsWorker = new Worker<PaymentJobData>(
  PAYMENT_QUEUE_NAME,
  processPaymentJob,
  { connection: paymentsConnection, concurrency: 2 },
);

const holdExpiryWorker = new Worker<HoldExpiryJobData>(
  HOLD_EXPIRY_QUEUE_NAME,
  processHoldExpiryJob,
  { connection: holdExpiryConnection, concurrency: 4 },
);

// ---------------------------------------------------------------------------
// Lifecycle events — terminal failure triggers the compensation path
// ---------------------------------------------------------------------------

paymentsWorker.on("active", (job) => {
  console.log(`[payments] ▶ processing booking ${job.data.bookingId} (attempt ${job.attemptsStarted})`);
});

paymentsWorker.on("completed", (job, result) => {
  console.log(
    `[payments] ✔ booking ${result.bookingId} → ${result.status} (job ${job.id})`,
  );
});

paymentsWorker.on("failed", async (job, error) => {
  if (!job) return;

  const attempts = job.opts.attempts ?? 1;
  // Terminal when BullMQ has used up every attempt. Both signals are
  // checked for robustness; the compensation below is idempotent anyway.
  const isFinalAttempt =
    job.attemptsStarted >= attempts || job.finishedOn !== null;

  if (isFinalAttempt) {
    console.error(
      `[payments] ✖ booking ${job.data.bookingId} FAILED after ${attempts} attempt(s): ${error.message}`,
    );
    try {
      // Compensation: booking → FAILED, seats → AVAILABLE. The transaction
      // inside only acts if the booking is still PENDING, so this can never
      // unwind a confirmed sale.
      await failBookingAndReleaseSeats(job.data.bookingId, error.message);
      console.log(`[payments] ↺ released seats of booking ${job.data.bookingId} for resale`);
    } catch (compensationError) {
      console.error(
        `[payments] compensation failed for booking ${job.data.bookingId}:`,
        compensationError,
      );
    }
  } else {
    // Exponential backoff as configured on the job: base · 2^(failures so far).
    const retryDelayMs = PAYMENT_BACKOFF_BASE_MS * 2 ** (job.attemptsStarted - 1);
    console.warn(
      `[payments] ⚠ booking ${job.data.bookingId} attempt ${job.attemptsStarted}/${attempts} failed: ${error.message} — retrying in ~${Math.round(retryDelayMs / 1000)}s`,
    );
  }
});

holdExpiryWorker.on("failed", (job, error) => {
  console.error(`[hold-expiry] ✖ release failed for hold ${job?.data.holdToken}: ${error.message}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} received — closing workers (no new jobs will be picked up)…`);

  // worker.close() waits for the active job to finish (with a timeout guard).
  await Promise.race([
    Promise.all([paymentsWorker.close(), holdExpiryWorker.close()]),
    sleep(30_000),
  ]);

  await Promise.allSettled([
    paymentsConnection.quit(),
    holdExpiryConnection.quit(),
    prisma.$disconnect(),
  ]);

  console.log("[worker] shutdown complete. Bye!");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(
  `[worker] SeatFlow worker online — queues: "${PAYMENT_QUEUE_NAME}", "${HOLD_EXPIRY_QUEUE_NAME}"`,
);
console.log(
  `[worker] payment simulation: 2s latency, ${PAYMENT_MAX_ATTEMPTS} attempts, exponential backoff (base ${PAYMENT_BACKOFF_BASE_MS}ms)`,
);
console.log(
  `[worker] FORCE_PAYMENT_SUCCESS=${process.env.FORCE_PAYMENT_SUCCESS ?? "false"} (random 15% declines unless "true")`,
);
