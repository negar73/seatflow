"use client";

/**
 * Booking status view.
 *
 * Polls GET /api/bookings/[id] every 2 seconds while the payment is PENDING
 * and drives an animated status stepper:
 *
 *   Seats held ──► Payment processing ──► Confirmed / Failed
 *
 * On final payment failure the seats are automatically released by the
 * worker (compensation), and this page offers a "try again" path back to
 * the seat map.
 */

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiFetch, ApiClientError } from "@/lib/client";
import { formatEventDate, formatPrice } from "@/lib/money";
import type { BookingDto } from "@/types/api";

// ---------------------------------------------------------------------------
// Status stepper
// ---------------------------------------------------------------------------

type StepState = "done" | "active" | "failed" | "upcoming";

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case "done":
      return <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />;
    case "active":
      return <Loader2 className="h-5 w-5 animate-spin text-foreground/60" aria-hidden="true" />;
    case "failed":
      return <XCircle className="h-5 w-5 text-destructive" aria-hidden="true" />;
    case "upcoming":
      return <Circle className="h-5 w-5 text-muted-foreground/50" aria-hidden="true" />;
  }
}

function StatusStepper({ booking }: { booking: BookingDto }) {
  const steps: { label: string; hint: string; state: StepState }[] = [
    {
      label: "Seats held",
      hint: "Your seats were locked for you.",
      state: "done",
    },
    {
      label: "Payment processing",
      hint:
        booking.status === "PENDING"
          ? "The mock gateway is charging your card…"
          : "The gateway completed its attempts.",
      state:
        booking.status === "PENDING"
          ? "active"
          : booking.status === "CONFIRMED"
            ? "done"
            : "failed",
    },
    {
      label:
        booking.status === "FAILED" ? "Payment failed" : "Booking confirmed",
      hint:
        booking.status === "CONFIRMED"
          ? "Enjoy the event — your seats are secured."
          : booking.status === "FAILED"
            ? "Seats were released back to inventory."
            : "Awaiting payment result…",
      state:
        booking.status === "PENDING"
          ? "upcoming"
          : booking.status === "CONFIRMED"
            ? "done"
            : "failed",
    },
  ];

  return (
    <ol className="space-y-0" aria-label="Booking progress">
      {steps.map((step, index) => (
        <li key={step.label} className="relative flex gap-3 pb-6 last:pb-0">
          {/* Connector line */}
          {index < steps.length - 1 && (
            <span
              className={`absolute left-[11px] top-7 h-[calc(100%-1.75rem)] w-0.5 ${
                step.state === "done" ? "bg-emerald-500/60" : "bg-border"
              }`}
              aria-hidden="true"
            />
          )}
          <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card">
            <StepIcon state={step.state} />
          </span>
          <div className="pt-0.5">
            <p
              className={`text-sm font-semibold ${
                step.state === "failed" ? "text-destructive" : ""
              } ${step.state === "upcoming" ? "text-muted-foreground" : ""}`}
            >
              {step.label}
            </p>
            <p className="text-xs text-muted-foreground">{step.hint}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function BookingStatusView({ bookingId }: { bookingId: string }) {
  const [booking, setBooking] = useState<BookingDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<BookingDto>(`/api/bookings/${bookingId}`);
      setBooking(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load booking.");
    }
  }, [bookingId]);

  // Initial load (and re-load whenever the poll tick advances).
  useEffect(() => {
    void load();
  }, [load, pollTick]);

  // Poll every 2s while payment is pending; stop once terminal.
  useEffect(() => {
    if (booking === null || booking.status !== "PENDING") return;
    const interval = setInterval(() => setPollTick((t) => t + 1), 2_000);
    return () => clearInterval(interval);
  }, [booking]);

  if (error !== null && booking === null) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16 sm:px-6">
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center"
        >
          <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Booking not found</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Link
            href="/"
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Browse events
          </Link>
        </div>
      </div>
    );
  }

  if (booking === null) {
    return (
      <div className="mx-auto w-full max-w-2xl animate-pulse px-4 py-10 sm:px-6">
        <div className="h-80 rounded-xl bg-muted" />
      </div>
    );
  }

  const isPending = booking.status === "PENDING";
  const isConfirmed = booking.status === "CONFIRMED";
  const isFailed = booking.status === "FAILED";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 sm:px-6">
      <header className="py-8">
        <Link
          href={`/events/${booking.eventId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to event
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          {isConfirmed
            ? "You're going! 🎉"
            : isFailed
              ? "Payment didn't go through"
              : "Processing your payment…"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {booking.eventTitle} ·{" "}
          {formatEventDate(booking.createdAt)}
        </p>
      </header>

      {/* Live status banner */}
      <div
        role="status"
        aria-live="polite"
        className={`mb-6 rounded-xl border p-4 ${
          isPending
            ? "border-amber-500/40 bg-amber-500/10"
            : isConfirmed
              ? "border-emerald-500/40 bg-emerald-500/10"
              : "border-destructive/40 bg-destructive/5"
        }`}
      >
        <div className="flex items-center gap-3">
          {isPending && (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" aria-hidden="true" />
          )}
          {isConfirmed && (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          )}
          {isFailed && (
            <XCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {isPending && "Payment in progress — this page updates automatically every 2 seconds."}
              {isConfirmed && "Payment confirmed. Your seats are booked."}
              {isFailed && "Payment failed after 3 attempts — your seats have been released."}
            </p>
            {isFailed && booking.failureReason && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Reason: {booking.failureReason}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
        {/* Stepper + seats */}
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
            <StatusStepper booking={booking} />
          </div>

          {isFailed && (
            <Link
              href={`/events/${booking.eventId}`}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again with new seats
            </Link>
          )}
        </div>

        {/* Receipt card */}
        <aside
          aria-label="Booking receipt"
          className="h-fit rounded-xl border border-border bg-card p-4 sm:w-72 sm:p-5"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Reference
          </h2>
          <p className="mt-1 break-all font-mono text-xs">{booking.id}</p>

          <h2 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Seats
          </h2>
          <ul className="mt-1.5 space-y-1">
            {booking.seats.map((seat) => (
              <li key={seat.id} className="flex justify-between gap-2 text-sm">
                <span>
                  {seat.section}
                  {seat.row}·{seat.seatNumber}
                </span>
                <span>{formatPrice(seat.priceCents)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-base font-bold">{formatPrice(booking.totalCents)}</span>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            {booking.customerName} · {booking.customerEmail}
          </p>
        </aside>
      </div>
    </div>
  );
}
