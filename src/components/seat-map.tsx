"use client";

/**
 * Interactive seat map.
 *
 * Seat colours mirror live inventory from GET /api/events/[id]:
 *   AVAILABLE → neutral (selectable)      HELD → amber (someone's 5-min hold)
 *   BOOKED    → dark (sold)               locally selected → emerald ring
 *
 * Selecting seats (up to 6) and pressing "Hold seats" calls
 * POST /api/events/[id]/hold. On success the user is routed to
 * /checkout?hold=<token> with a live 5-minute countdown waiting there.
 */

import {
  AlertTriangle,
  Armchair,
  CalendarDays,
  Loader2,
  MapPin,
  RefreshCw,
  Timer,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { apiFetch, ApiClientError } from "@/lib/client";
import { MAX_SEATS_PER_HOLD } from "@/lib/constants";
import { formatEventDate, formatPrice } from "@/lib/money";
import {
  useSeatSelection,
  type SelectedSeat,
} from "@/stores/seat-selection";
import type { EventDetailDto, SeatDto } from "@/types/api";

// ---------------------------------------------------------------------------
// Seat rendering helpers
// ---------------------------------------------------------------------------

function seatStatusClasses(seat: SeatDto, isSelected: boolean): string {
  if (isSelected) {
    return "bg-emerald-500/25 text-emerald-900 ring-2 ring-emerald-500 hover:bg-emerald-500/35 dark:text-emerald-200";
  }
  switch (seat.status) {
    case "AVAILABLE":
      return "bg-secondary text-secondary-foreground ring-1 ring-inset ring-border hover:bg-emerald-500/20 hover:ring-emerald-500/60";
    case "HELD":
      return "cursor-not-allowed bg-amber-400/80 text-amber-950 dark:bg-amber-500/70 dark:text-amber-950";
    case "BOOKED":
      return "cursor-not-allowed bg-zinc-800 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400";
  }
}

function SeatButton({
  seat,
  isSelected,
  onToggle,
}: {
  seat: SeatDto;
  isSelected: boolean;
  onToggle: (seat: SelectedSeat) => void;
}) {
  const selectable = seat.status === "AVAILABLE";
  const label = `Row ${seat.row}, seat ${seat.seatNumber} — ${formatPrice(seat.priceCents)} — ${
    isSelected ? "selected" : seat.status.toLowerCase()
  }`;

  return (
    <button
      type="button"
      disabled={!selectable}
      aria-pressed={isSelected}
      aria-label={label}
      title={label}
      onClick={() =>
        selectable &&
        onToggle({
          id: seat.id,
          section: seat.section,
          row: seat.row,
          seatNumber: seat.seatNumber,
          priceCents: seat.priceCents,
        })
      }
      className={`flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-semibold transition-colors sm:h-8 sm:w-8 sm:text-xs ${seatStatusClasses(
        seat,
        isSelected,
      )} ${selectable ? "focus-visible:outline-2 focus-visible:outline-ring" : ""}`}
    >
      {seat.seatNumber}
    </button>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`inline-block h-4 w-4 rounded ${className}`} aria-hidden="true" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SeatMap({ eventId }: { eventId: string }) {
  const router = useRouter();

  const [detail, setDetail] = useState<EventDetailDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [isHolding, setIsHolding] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);
  const [limitHint, setLimitHint] = useState(false);

  const selectedSeats = useSeatSelection((s) => s.selectedSeats);
  const toggleSeat = useSeatSelection((s) => s.toggleSeat);
  const clearSelection = useSeatSelection((s) => s.clear);
  const totalCents = useSeatSelection((s) => s.totalCents());

  const loadEvent = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await apiFetch<EventDetailDto>(`/api/events/${eventId}`);
      setDetail(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load the seat map.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [eventId]);

  // Fresh selection state per event page.
  useEffect(() => {
    clearSelection();
    setHoldError(null);
  }, [eventId, clearSelection]);

  useEffect(() => {
    void loadEvent();
  }, [loadEvent]);

  const selectedIds = selectedSeats.map((s) => s.id);
  const isSelected = (seatId: string) => selectedIds.includes(seatId);

  async function handleHoldSeats() {
    if (selectedSeats.length === 0 || isHolding) return;
    setIsHolding(true);
    setHoldError(null);
    try {
      const hold = await apiFetch<{ holdToken: string }>(
        `/api/events/${eventId}/hold`,
        {
          method: "POST",
          body: JSON.stringify({ seatIds: selectedIds }),
        },
      );
      router.push(`/checkout?hold=${hold.holdToken}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "SEATS_UNAVAILABLE") {
        setHoldError(
          "Some of your seats were just taken by someone else. The map below has been refreshed — please pick again.",
        );
      } else {
        setHoldError(
          err instanceof Error ? err.message : "Could not hold those seats.",
        );
      }
      // Re-sync the map with fresh statuses either way.
      await loadEvent();
    } finally {
      setIsHolding(false);
    }
  }

  // ---------------------------------------------------------------------------

  if (loadError !== null && detail === null) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div
          role="alert"
          className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center"
        >
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="text-sm">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadEvent()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="mx-auto w-full max-w-6xl animate-pulse px-4 py-10 sm:px-6">
        <div className="h-8 w-2/3 rounded bg-muted" />
        <div className="mt-3 h-4 w-1/3 rounded bg-muted" />
        <div className="mt-8 h-96 rounded-xl bg-muted" />
      </div>
    );
  }

  const { event, summary, sections } = detail;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      {/* Event header */}
      <header className="flex flex-col gap-4 py-8 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-amber-500/10 text-4xl">
          <span role="img" aria-label={`${event.title} poster`}>
            {event.posterEmoji}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {event.title}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {event.venue}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              {formatEventDate(event.startsAt)}
            </span>
          </p>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {event.description}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadEvent()}
          disabled={isRefreshing}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-md border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
          title="Refresh seat statuses"
        >
          <RefreshCw
            className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh
        </button>
      </header>

      {holdError !== null && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <p>{holdError}</p>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        {/* Seat map column */}
        <section aria-label="Seat map" className="order-2 lg:order-1">
          {/* Legend */}
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
            <LegendSwatch className="bg-secondary ring-1 ring-inset ring-border" label="Available" />
            <LegendSwatch className="bg-amber-400/80 dark:bg-amber-500/70" label="Held (5 min)" />
            <LegendSwatch className="bg-zinc-800 dark:bg-zinc-700" label="Booked" />
            <LegendSwatch className="bg-emerald-500/25 ring-2 ring-emerald-500" label="Your selection" />
          </div>

          {/* Stage */}
          <div className="mx-auto mb-8 max-w-md">
            <div className="h-2 rounded-b-full bg-gradient-to-r from-emerald-600/70 via-emerald-500 to-emerald-600/70" />
            <p className="mt-2 text-center text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
              Stage
            </p>
          </div>

          {/* Sections */}
          <div className="space-y-8">
            {sections.map((section) => {
              const sectionPrice = section.rows[0]?.seats[0]?.priceCents ?? 0;
              return (
                <div
                  key={section.name}
                  className="rounded-xl border border-border bg-card p-4 sm:p-6"
                >
                  <div className="mb-4 flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wider">
                      Section {section.name}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {formatPrice(sectionPrice)} per seat
                    </span>
                  </div>

                  <div className="space-y-2 overflow-x-auto pb-1 nice-scrollbar">
                    {section.rows.map((row) => (
                      <div key={row.row} className="flex items-center gap-3">
                        <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">
                          {row.row}
                        </span>
                        <div className="flex gap-1.5">
                          {row.seats.map((seat) => (
                            <SeatButton
                              key={seat.id}
                              seat={seat}
                              isSelected={isSelected(seat.id)}
                              onToggle={(s) => {
                                const result = toggleSeat(s);
                                setLimitHint(result.atLimit);
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
            <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Once you hold seats, they stay yours for {Math.round(detail.holdDurationSeconds / 60)} minutes — finish checkout before the timer runs out.
          </p>
        </section>

        {/* Selection sidebar */}
        <aside
          aria-label="Your selection"
          className="order-1 lg:order-2 lg:sticky lg:top-20 lg:self-start"
        >
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Armchair className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Your selection
            </h2>

            {selectedSeats.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No seats selected yet. Tap any green seat on the map — you can
                pick up to {MAX_SEATS_PER_HOLD}.
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {selectedSeats.map((seat) => (
                  <li
                    key={seat.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm"
                  >
                    <span>
                      Sect. {seat.section} · Row {seat.row} · Seat{" "}
                      {seat.seatNumber}
                    </span>
                    <span className="font-medium">
                      {formatPrice(seat.priceCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm">
              <span className="text-muted-foreground">
                {selectedSeats.length} seat{selectedSeats.length === 1 ? "" : "s"}
              </span>
              <span className="text-lg font-bold">{formatPrice(totalCents)}</span>
            </div>

            {limitHint && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                You can hold up to {MAX_SEATS_PER_HOLD} seats per booking.
              </p>
            )}

            <button
              type="button"
              onClick={() => void handleHoldSeats()}
              disabled={selectedSeats.length === 0 || isHolding}
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isHolding ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Holding your seats…
                </>
              ) : (
                <>
                  <Timer className="h-4 w-4" aria-hidden="true" />
                  Hold seats for 5:00
                </>
              )}
            </button>

            <button
              type="button"
              onClick={clearSelection}
              disabled={selectedSeats.length === 0}
              className="mt-2 h-9 w-full rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              Clear selection
            </button>

            <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4 text-center">
              <div>
                <dt className="text-xs text-muted-foreground">Available</dt>
                <dd className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {summary.availableSeats}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Held</dt>
                <dd className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                  {summary.heldSeats}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Booked</dt>
                <dd className="text-sm font-semibold">{summary.bookedSeats}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
