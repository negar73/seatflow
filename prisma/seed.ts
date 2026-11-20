/**
 * SeatFlow database seed.
 *
 * Creates two demo events, each with a realistic seat map:
 *   - Section A — 5 rows × 10 seats, premium pricing (€85.00)
 *   - Section B — 5 rows × 10 seats, standard pricing (€45.00)
 *
 * Run with: npm run db:seed
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SectionConfig {
  name: string;
  rows: number;
  seatsPerRow: number;
  priceCents: number;
}

const SECTION_CONFIGS: SectionConfig[] = [
  { name: "A", rows: 5, seatsPerRow: 10, priceCents: 8500 },
  { name: "B", rows: 5, seatsPerRow: 10, priceCents: 4500 },
];

const EVENTS = [
  {
    title: "Tehran Tech Talks 2025",
    description:
      "An evening of short, high-signal talks on distributed systems, TypeScript at scale and shipping fast without breaking things. Doors open one hour before the first talk — come early, grab a seat (hold it, even) and meet the community.",
    venue: "Milad Convention Hall, Tehran",
    startsAt: new Date("2025-11-14T17:30:00.000Z"),
    posterEmoji: "🎤",
  },
  {
    title: "Autumn Jazz Night",
    description:
      "A quartet of Tehran's finest session players performs late-night jazz standards and original arrangements under warm autumn lights. Seats are unreserved until you hold them — pick your row and make the evening yours.",
    venue: "Roudaki Foundation Hall, Tehran",
    startsAt: new Date("2025-10-03T18:00:00.000Z"),
    posterEmoji: "🎷",
  },
];

async function seedEvent(event: (typeof EVENTS)[number]): Promise<void> {
  const created = await prisma.event.create({ data: event });

  const seats = SECTION_CONFIGS.flatMap((section) =>
    Array.from({ length: section.rows * section.seatsPerRow }, (_, i) => ({
      eventId: created.id,
      section: section.name,
      row: Math.floor(i / section.seatsPerRow) + 1,
      seatNumber: (i % section.seatsPerRow) + 1,
      priceCents: section.priceCents,
    })),
  );

  await prisma.seat.createMany({ data: seats });

  console.log(
    `  ✔ ${created.title} — ${seats.length} seats across ${SECTION_CONFIGS.length} sections`,
  );
}

async function main(): Promise<void> {
  console.log("Seeding SeatFlow…");

  // Idempotent re-runs: clear child tables first, then events (seats cascade).
  await prisma.bookingSeat.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.event.deleteMany();

  for (const event of EVENTS) {
    await seedEvent(event);
  }

  console.log("Done. Run `npm run dev` and open the app to browse events.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
