/**
 * Zod schemas for every API input.
 *
 * The rules enforced here mirror the engine's invariants (e.g. the
 * 6-seat-per-hold ceiling lives in src/lib/constants.ts and is re-checked
 * inside the reservation transaction — this schema just fails fast with
 * friendly messages).
 */

import { z } from "zod";

import { MAX_SEATS_PER_HOLD } from "@/lib/constants";

export const holdRequestSchema = z.object({
  seatIds: z
    .array(z.string().min(1, "Seat id must not be empty."))
    .min(1, "Select at least one seat.")
    .max(
      MAX_SEATS_PER_HOLD,
      `You can hold up to ${MAX_SEATS_PER_HOLD} seats at a time.`,
    ),
});

export const confirmRequestSchema = z.object({
  holdToken: z
    .string()
    .min(16, "Missing or malformed hold token.")
    .max(128),
  customerName: z
    .string()
    .trim()
    .min(2, "Please enter your full name (at least 2 characters).")
    .max(80, "Name must be at most 80 characters."),
  customerEmail: z
    .string()
    .trim()
    .pipe(z.email("Please enter a valid email address.")),
  // Mock gateway fields — validated lightly to keep the checkout contract
  // realistic. Real gateways would tokenize these on the client.
  cardNumber: z
    .string()
    .transform((value) => value.replace(/[\s-]/g, ""))
    .pipe(
      z
        .string()
        .regex(/^\d{15,16}$/, "Card number must be 15–16 digits."),
    ),
  cardExpiry: z
    .string()
    .trim()
    .regex(/^(0[1-9]|1[0-2])\/\d{2}$/, "Expiry must use MM/YY format."),
  cardCvc: z
    .string()
    .trim()
    .regex(/^\d{3,4}$/, "CVC must be 3–4 digits."),
  // Optional because the canonical transport is the Idempotency-Key header;
  // the body field is a fallback for clients that cannot set headers.
  idempotencyKey: z.string().min(8).max(64).optional(),
});

export type HoldRequest = z.infer<typeof holdRequestSchema>;
export type ConfirmRequest = z.infer<typeof confirmRequestSchema>;
