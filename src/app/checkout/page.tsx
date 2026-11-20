"use client";

/**
 * Checkout page — /checkout?hold=<token>
 *
 * Shows the held seats with a live 5-minute countdown driven by the hold's
 * real `expiresAt`, plus a guest form with mock card fields. The confirm
 * button POSTs /api/bookings/confirm with an `Idempotency-Key` that is
 * generated exactly once per checkout and reused on retries — that is what
 * makes double-submitting (double-charging) impossible.
 */

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Hourglass,
  Loader2,
  Lock,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";

import { apiFetch, ApiClientError } from "@/lib/client";
import { formatCountdown, formatPrice } from "@/lib/money";
import type { BookingDto, HoldDto } from "@/types/api";

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

function useCountdown(expiresAtIso: string | null): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAtIso) return;
    const target = new Date(expiresAtIso).getTime();
    const tick = () => setSecondsLeft(Math.floor((target - Date.now()) / 1000));
    void tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAtIso]);

  return secondsLeft;
}

function urgencyClasses(secondsLeft: number | null): string {
  if (secondsLeft === null) return "text-muted-foreground";
  if (secondsLeft <= 60) return "text-red-600 dark:text-red-400 animate-pulse";
  if (secondsLeft <= 120) return "text-amber-600 dark:text-amber-400";
  return "text-foreground";
}

// ---------------------------------------------------------------------------
// Page (wrapped in Suspense because useSearchParams requires it)
// ---------------------------------------------------------------------------

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-5xl animate-pulse px-4 py-10 sm:px-6">
          <div className="h-96 rounded-xl bg-muted" />
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const holdToken = searchParams.get("hold");

  const [hold, setHold] = useState<HoldDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    cardNumber: "4242 4242 4242 4242",
    cardExpiry: "12/28",
    cardCvc: "123",
  });
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [holdEnded, setHoldEnded] = useState(false);

  // One idempotency key per checkout — generated lazily on first submit and
  // reused verbatim for every retry of this checkout session.
  const idempotencyKeyRef = useRef<string>("");

  const secondsLeft = useCountdown(hold?.expiresAt ?? null);

  useEffect(() => {
    if (!holdToken) {
      setLoadError("No hold token in the URL. Start by selecting seats on an event page.");
      return;
    }
    const controller = new AbortController();
    apiFetch<HoldDto>(`/api/holds/${holdToken}`, { signal: controller.signal })
      .then((data) => {
        setHold(data);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiClientError) {
          setErrorCode(err.code);
          setLoadError(err.message);
        } else {
          setLoadError("Failed to load your hold.");
        }
      });
    return () => controller.abort();
  }, [holdToken]);

  // Client-side expiry: freeze the form the moment the countdown hits zero.
  useEffect(() => {
    if (secondsLeft !== null && secondsLeft <= 0) setHoldEnded(true);
  }, [secondsLeft]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!holdToken || !hold || isConfirming || holdEnded) return;

    if (idempotencyKeyRef.current === "") {
      idempotencyKeyRef.current = nanoid();
    }

    setIsConfirming(true);
    setConfirmError(null);
    try {
      const booking = await apiFetch<BookingDto>("/api/bookings/confirm", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKeyRef.current },
        body: JSON.stringify({
          holdToken,
          customerName: form.customerName,
          customerEmail: form.customerEmail,
          cardNumber: form.cardNumber,
          cardExpiry: form.cardExpiry,
          cardCvc: form.cardCvc,
        }),
      });
      router.push(`/bookings/${booking.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "HOLD_EXPIRED" || err.code === "HOLD_INVALID") {
          setHoldEnded(true);
          setErrorCode(err.code);
          setLoadError(err.message);
        } else {
          setConfirmError(err.message);
        }
      } else {
        setConfirmError("Something went wrong. Please try again.");
      }
    } finally {
      setIsConfirming(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Error / expired states
  // ---------------------------------------------------------------------------

  if (loadError !== null && hold === null) {
    const isExpired = errorCode === "HOLD_EXPIRED";
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16 sm:px-6">
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center"
        >
          {isExpired ? (
            <Hourglass className="h-7 w-7 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden="true" />
          )}
          <h1 className="text-lg font-semibold">
            {isExpired ? "Your hold expired" : "Hold unavailable"}
          </h1>
          <p className="text-sm text-muted-foreground">{loadError}</p>
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

  if (hold === null) {
    return (
      <div className="mx-auto w-full max-w-5xl animate-pulse px-4 py-10 sm:px-6">
        <div className="h-96 rounded-xl bg-muted" />
      </div>
    );
  }

  const countdownLabel =
    secondsLeft === null ? "--:--" : formatCountdown(secondsLeft);
  const expired = holdEnded || (secondsLeft !== null && secondsLeft <= 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
      <header className="py-8">
        <Link
          href={`/events/${hold.eventId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to seat map
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          Checkout
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {hold.eventTitle} — complete your booking before the hold expires.
        </p>
      </header>

      {/* Countdown banner */}
      <div
        className={`mb-6 flex items-center justify-between gap-4 rounded-xl border p-4 ${
          expired
            ? "border-destructive/40 bg-destructive/5"
            : "border-border bg-card"
        }`}
      >
        <div className="flex items-center gap-3">
          <Timer
            className={`h-5 w-5 ${expired ? "text-destructive" : urgencyClasses(secondsLeft)}`}
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-semibold">
              {expired ? "Your hold has expired" : "Seats held for you"}
            </p>
            <p className="text-xs text-muted-foreground">
              {expired
                ? "The seats were released back to inventory — please pick again."
                : "Finish checkout before the timer reaches zero, or the seats are released."}
            </p>
          </div>
        </div>
        <p
          className={`font-mono text-3xl font-bold tabular-nums ${urgencyClasses(secondsLeft)}`}
          aria-live="polite"
          aria-label={`${countdownLabel} remaining`}
        >
          {countdownLabel}
        </p>
      </div>

      {expired && (
        <div className="mb-6">
          <Link
            href={`/events/${hold.eventId}`}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            Choose new seats
          </Link>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        {/* Guest + payment form */}
        <form onSubmit={handleSubmit} className="space-y-6" noValidate={false}>
          <fieldset className="rounded-xl border border-border bg-card p-4 sm:p-6" disabled={expired}>
            <legend className="px-1 text-sm font-semibold">Your details</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="name" className="mb-1.5 block text-sm font-medium">
                  Full name
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="ada@example.com"
                  value={form.customerEmail}
                  onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Your booking reference will be tied to this address.
                </p>
              </div>
            </div>
          </fieldset>

          <fieldset className="rounded-xl border border-border bg-card p-4 sm:p-6" disabled={expired}>
            <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold">
              <CreditCard className="h-4 w-4" aria-hidden="true" />
              Payment
            </legend>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="sm:col-span-4">
                <label htmlFor="card" className="mb-1.5 block text-sm font-medium">
                  Card number
                </label>
                <input
                  id="card"
                  inputMode="numeric"
                  required
                  value={form.cardNumber}
                  onChange={(e) => setForm({ ...form, cardNumber: e.target.value })}
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none transition-colors focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                />
              </div>
              <div>
                <label htmlFor="expiry" className="mb-1.5 block text-sm font-medium">
                  Expiry
                </label>
                <input
                  id="expiry"
                  required
                  placeholder="MM/YY"
                  value={form.cardExpiry}
                  onChange={(e) => setForm({ ...form, cardExpiry: e.target.value })}
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none transition-colors focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                />
              </div>
              <div>
                <label htmlFor="cvc" className="mb-1.5 block text-sm font-medium">
                  CVC
                </label>
                <input
                  id="cvc"
                  required
                  inputMode="numeric"
                  value={form.cardCvc}
                  onChange={(e) => setForm({ ...form, cardCvc: e.target.value })}
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none transition-colors focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                />
              </div>
              <p className="sm:col-span-4 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                Mock gateway — card fields are pre-filled with a test card and
                never leave this server. No real charge is made.
              </p>
            </div>
          </fieldset>

          {confirmError !== null && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <div>
                <p>{confirmError}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  You can safely press Confirm again — the same idempotency key
                  guarantees you are never charged twice.
                </p>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isConfirming || expired}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-8"
          >
            {isConfirming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Confirming…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Confirm and pay {formatPrice(hold.totalCents)}
              </>
            )}
          </button>
        </form>

        {/* Order summary */}
        <aside aria-label="Order summary" className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <h2 className="text-base font-semibold">Order summary</h2>
            <ul className="mt-3 space-y-1.5">
              {hold.seats.map((seat) => (
                <li
                  key={seat.id}
                  className="flex items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm"
                >
                  <span>
                    Sect. {seat.section} · Row {seat.row} · Seat {seat.seatNumber}
                  </span>
                  <span className="font-medium">{formatPrice(seat.priceCents)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-lg font-bold">{formatPrice(hold.totalCents)}</span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {hold.seats.length} seat{hold.seats.length === 1 ? "" : "s"} ·{" "}
              {hold.eventTitle}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
