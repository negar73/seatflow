/**
 * Tiny typed fetch wrapper for the browser.
 *
 * Surfaces the API's structured error envelope (`code` / `message`) as an
 * exception so components can branch on error codes — e.g. HOLD_EXPIRED
 * sends the user back to the seat map.
 */

import type { ApiErrorBody } from "@/types/api";

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    // Let aborts propagate untouched so callers can ignore them.
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiClientError(
      "NETWORK",
      "Could not reach the server. Check your connection and try again.",
      0,
    );
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = body as ApiErrorBody | null;
    throw new ApiClientError(
      parsed?.error?.code ?? "INTERNAL",
      parsed?.error?.message ?? "Something went wrong. Please try again.",
      response.status,
      parsed?.error?.details,
    );
  }

  return body as T;
}
