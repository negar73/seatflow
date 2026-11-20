"use client";

import { use } from "react";

import { BookingStatusView } from "@/components/booking-status-view";

/**
 * Booking status page — /bookings/[id].
 * `params` is a Promise in the Next.js App Router; unwrapped with `use()`.
 */
export default function BookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <BookingStatusView bookingId={id} />;
}
