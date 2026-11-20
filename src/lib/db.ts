/**
 * Prisma Client singleton.
 *
 * Next.js hot-reloads modules in development, which would otherwise open a
 * new connection pool on every change. Caching the client on `globalThis`
 * in non-production environments keeps a single pool per process.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
