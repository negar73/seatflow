/**
 * Typed application errors.
 *
 * Every error the reservation engine throws maps 1:1 to an HTTP status code
 * and a machine-readable `code`, so API clients (and the UI) can react
 * precisely — e.g. `HOLD_EXPIRED` → send the user back to the seat map,
 * `SEATS_UNAVAILABLE` → refresh the map and highlight the conflict.
 */

export type AppErrorCode =
  | "EVENT_NOT_FOUND"
  | "SEAT_NOT_FOUND"
  | "SEATS_UNAVAILABLE"
  | "HOLD_EXPIRED"
  | "HOLD_INVALID"
  | "IDEMPOTENCY_CONFLICT"
  | "BOOKING_NOT_FOUND"
  | "VALIDATION_ERROR"
  | "PAYMENT_QUEUE_UNAVAILABLE"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: AppErrorCode,
    message: string,
    status: number = 400,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** The event referenced in the URL does not exist. */
export class EventNotFoundError extends AppError {
  constructor(eventId: string) {
    super("EVENT_NOT_FOUND", `No event found with id "${eventId}".`, 404);
  }
}

/** The selection contains seats that don't belong to the event (or don't exist). */
export class SeatNotFoundError extends AppError {
  constructor(seatIds: string[]) {
    super(
      "SEAT_NOT_FOUND",
      "Some of the selected seats do not exist for this event.",
      400,
      { seatIds },
    );
  }
}

/** At least one seat in the selection was taken by someone else first. */
export class SeatsUnavailableError extends AppError {
  constructor(seatIds: string[]) {
    super(
      "SEATS_UNAVAILABLE",
      "Some of the selected seats are no longer available. The seat map has been refreshed — please adjust your selection.",
      409,
      { seatIds },
    );
  }
}

/** The hold existed but its 5-minute TTL has passed. */
export class HoldExpiredError extends AppError {
  constructor() {
    super(
      "HOLD_EXPIRED",
      "Your seat hold has expired. Please select your seats again.",
      410,
    );
  }
}

/** No seats (or seats with a foreign status) match the presented hold token. */
export class HoldInvalidError extends AppError {
  constructor() {
    super(
      "HOLD_INVALID",
      "This seat hold is no longer valid — it may have expired or already been used. Please select your seats again.",
      409,
    );
  }
}

/** Same idempotency key reused with different checkout data. */
export class IdempotencyConflictError extends AppError {
  constructor() {
    super(
      "IDEMPOTENCY_CONFLICT",
      "This idempotency key was already used with a different checkout request.",
      409,
    );
  }
}

/** Booking id in the URL does not exist. */
export class BookingNotFoundError extends AppError {
  constructor(bookingId: string) {
    super(
      "BOOKING_NOT_FOUND",
      `No booking found with reference "${bookingId}".`,
      404,
    );
  }
}

/** Redis/BullMQ could not accept the payment job after the booking committed. */
export class PaymentQueueUnavailableError extends AppError {
  constructor(cause: unknown) {
    super(
      "PAYMENT_QUEUE_UNAVAILABLE",
      "Your booking was created but the payment service is temporarily unreachable. The seats will be released automatically — please try again shortly.",
      503,
      { cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
}
