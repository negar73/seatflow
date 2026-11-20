import { Ticket } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Sticky site header: brand mark, primary nav and the theme toggle.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Ticket className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <span className="text-base font-semibold tracking-tight">
            SeatFlow
          </span>
        </Link>

        <nav aria-label="Main navigation" className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/"
            className="rounded-md px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          >
            Events
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
