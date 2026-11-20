"use client";

/**
 * Landing page — the events grid.
 *
 * Data comes from GET /api/events (the same public contract external
 * clients would use); the page renders loading skeletons and a retryable
 * error state while the request is in flight.
 */

import { AlertTriangle, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EventCard } from "@/components/event-card";
import { apiFetch } from "@/lib/client";
import type { EventSummaryDto } from "@/types/api";

export default function HomePage() {
  const [events, setEvents] = useState<EventSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    apiFetch<EventSummaryDto[]>("/api/events", { signal: controller.signal })
      .then((data) => {
        setEvents(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Failed to load events.",
        );
      });

    return () => controller.abort();
  }, [reloadKey]);

  const retry = useCallback(() => {
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      {/* Hero */}
      <section className="py-10 text-center sm:py-14">
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Concurrency-safe holds · idempotent checkout · queued payments
        </p>
        <h1 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
          Book tickets without the race condition.
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
          Pick your seats, hold them for five minutes, and check out at your
          own pace. Under the hood every hold is protected by PostgreSQL row
          locks, so two people can never buy the same seat.
        </p>
      </section>

      {/* States */}
      {error !== null && (
        <section
          role="alert"
          className="mx-auto mb-8 flex max-w-lg flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
        >
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="text-sm text-foreground">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        </section>
      )}

      {events === null && error === null && (
        <section aria-label="Loading events" className="grid gap-6 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="animate-pulse overflow-hidden rounded-xl border border-border"
            >
              <div className="h-40 bg-muted" />
              <div className="space-y-3 p-5">
                <div className="h-5 w-3/4 rounded bg-muted" />
                <div className="h-4 w-1/2 rounded bg-muted" />
                <div className="h-4 w-2/3 rounded bg-muted" />
              </div>
            </div>
          ))}
        </section>
      )}

      {events !== null && (
        <section aria-label="Upcoming events">
          {events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
              No events yet. Run <code className="font-mono">npm run db:seed</code> to
              create the demo catalogue.
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* How it works strip */}
      <section className="mt-14 rounded-xl border border-border bg-card p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Zap className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          What happens when you book
        </h2>
        <ol className="mt-4 grid gap-4 text-sm text-muted-foreground sm:grid-cols-3">
          <li className="rounded-lg bg-muted/60 p-4">
            <span className="mb-1 block font-semibold text-foreground">1 · Hold</span>
            Your seats are locked with <code className="font-mono text-xs">SELECT … FOR UPDATE</code> and
            reserved for you for exactly five minutes.
          </li>
          <li className="rounded-lg bg-muted/60 p-4">
            <span className="mb-1 block font-semibold text-foreground">2 · Checkout</span>
            You submit once; an idempotency key makes accidental double-clicks
            and network retries completely safe.
          </li>
          <li className="rounded-lg bg-muted/60 p-4">
            <span className="mb-1 block font-semibold text-foreground">3 · Payment</span>
            A background worker charges the (mock) gateway with retries — and
            releases your seats if it ultimately fails.
          </li>
        </ol>
      </section>
    </div>
  );
}
