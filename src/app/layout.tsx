import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SeatFlow — Event booking that survives the race condition",
    template: "%s · SeatFlow",
  },
  description:
    "A demo event booking platform with concurrency-safe seat holds, idempotent checkout and queue-based payment processing.",
};

/**
 * Root layout: min-height flex column so the footer sticks to the bottom of
 * the viewport on short pages and is pushed down naturally on long ones.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <footer className="mt-auto border-t border-border">
              <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-sm text-muted-foreground sm:flex-row sm:px-6">
                <p>
                  SeatFlow — a concurrency-safe booking demo built by Negar
                  Shojaei.
                </p>
                <p>Pessimistic locks · Idempotent checkout · Queue-based payments</p>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
