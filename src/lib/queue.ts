/**
 * Redis connection + BullMQ queues.
 *
 * Queues are created lazily and cached on `globalThis` so that:
 *   1. importing this module (e.g. during `next build` static analysis)
 *      never opens a connection, and
 *   2. hot reload in development doesn't leak connections.
 */

import { Queue } from "bullmq";
import IORedis from "ioredis";

/** Queue that carries booking payment jobs to the worker process. */
export const PAYMENT_QUEUE_NAME = "payments";

/** Queue that carries delayed seat-release jobs (one per hold, 5 min out). */
export const HOLD_EXPIRY_QUEUE_NAME = "hold-expiry";

const globalForRedis = globalThis as unknown as {
  seatflowRedis?: IORedis;
  seatflowPaymentQueue?: Queue;
  seatflowHoldExpiryQueue?: Queue;
};

/**
 * Shared (non-blocking) connection used by producers.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ — it makes commands wait
 * for reconnection instead of failing fast while Redis restarts.
 */
export const redisConnection =
  globalForRedis.seatflowRedis ??
  new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.seatflowRedis = redisConnection;
}

/** Lazily created producer for the payments queue. */
export function getPaymentQueue(): Queue {
  if (!globalForRedis.seatflowPaymentQueue) {
    globalForRedis.seatflowPaymentQueue = new Queue(PAYMENT_QUEUE_NAME, {
      connection: redisConnection,
    });
  }
  return globalForRedis.seatflowPaymentQueue;
}

/** Lazily created producer for the hold-expiry queue. */
export function getHoldExpiryQueue(): Queue {
  if (!globalForRedis.seatflowHoldExpiryQueue) {
    globalForRedis.seatflowHoldExpiryQueue = new Queue(HOLD_EXPIRY_QUEUE_NAME, {
      connection: redisConnection,
    });
  }
  return globalForRedis.seatflowHoldExpiryQueue;
}
