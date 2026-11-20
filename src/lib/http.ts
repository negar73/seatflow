/**
 * HTTP helpers shared by every route handler: zod-validated bodies and a
 * single error funnel that turns typed AppErrors into correct status codes.
 */

import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import { AppError } from "@/lib/errors";

/**
 * Parse and validate a JSON request body with zod.
 * Throws a 400 AppError (with per-field details) on invalid input.
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "Request body must be valid JSON.",
      400,
    );
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid request body.", 400, {
      fields: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    });
  }

  return result.data;
}

/**
 * Convert any thrown value into a JSON error response.
 * Known AppErrors keep their code/status; everything else is a 500 whose
 * details are logged server-side but never leaked to the client.
 */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }

  console.error("[api] unhandled error:", error);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong. Please try again." } },
    { status: 500 },
  );
}
