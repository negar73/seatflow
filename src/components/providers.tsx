"use client";

/**
 * Client-side providers. Currently only the theme provider (dark/light via
 * a class on <html>); more providers can be layered in here later.
 */

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
