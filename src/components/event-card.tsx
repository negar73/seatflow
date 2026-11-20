"use client";

import { ArrowRight, CalendarDays, MapPin, Users } from "lucide-react";
import Link from "next/link";

import { formatEventDate, formatPrice } from "@/lib/money";
import type { EventSummaryDto } from "@/types/api";

/**
 * Landing-grid card for one event: emoji "poster", key facts and a
 * price-from / availability strip.
 */
export function EventCard({ event }: { event: EventSummaryDto }) {
  const soldOut = event.totalSeats > 0 && event.availableSeats === 0;

  return (
    <Link
      href={`/events/${event.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"
    >
      {/* Emoji "poster" */}
      <div className="flex h-40 items-center justify-center bg-gradient-to-br from-emerald-500/15 via-transparent to-amber-500/10">
        <span
          className="text-6xl transition-transform duration-200 group-hover:scale-110"
          role="img"
          aria-label={`${event.title} poster`}
        >
          {event.posterEmoji}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold leading-snug tracking-tight">
            {event.title}
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {event.venue}
          </p>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {formatEventDate(event.startsAt)}
          </p>
        </div>

        <p className="line-clamp-2 text-sm text-muted-foreground">
          {event.description}
        </p>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
          <div>
            <p className="text-sm font-semibold">
              from {formatPrice(event.priceFromCents)}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3 w-3" aria-hidden="true" />
              {soldOut
                ? "Sold out"
                : `${event.availableSeats} of ${event.totalSeats} seats available`}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground transition-colors group-hover:bg-emerald-600 group-hover:text-white">
            Book
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>
      </div>
    </Link>
  );
}
