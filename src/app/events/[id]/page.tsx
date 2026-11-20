"use client";

import { use } from "react";

import { SeatMap } from "@/components/seat-map";

/**
 * Event detail page — renders the interactive seat map for one event.
 * `params` is a Promise in Next.js App Router and is unwrapped with `use()`.
 */
export default function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <SeatMap eventId={id} />;
}
