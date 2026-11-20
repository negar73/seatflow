# SeatFlow

**A booking platform that survives the race condition.**

SeatFlow is a production-shaped event ticketing demo built around one hard problem: *two people try to buy the same seat at the same time — exactly one of them wins, and nobody is double-charged.* The interesting parts (pessimistic row locking, hold TTLs, idempotent checkout, queue-based payments with retries and seat-releasing compensation) are implemented as real, running code — not described in comments.

[![CI](https://github.com/negar73/seatflow/actions/workflows/ci.yml/badge.svg)](https://github.com/negar73/seatflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

---

## Features

- **Interactive seat map** — sections, rows and per-seat pricing; live availability (available / held / booked), multi-select up to 6 seats with a running total.
- ⏱ **5-minute seat holds** — claiming seats starts a real TTL. A countdown on checkout shows exactly how long you have; expiry is enforced three independent ways (delayed job, cron endpoint, lazy sweep).
- **Idempotent checkout** — every confirm request carries an `Idempotency-Key`; retries, double-clicks and flaky networks can never create a second booking or charge.
- **Queue-based payment processing** — checkout returns instantly while a BullMQ worker charges a mock gateway (2 s latency, 15% random declines, 3 attempts with exponential backoff) and the booking page live-polls the result.
- ↩ **Compensation on failure** — when payment fails for good, the worker atomically marks the booking `FAILED` *and* releases the seats back to inventory.
- **Booking status page** — animated stepper (held → processing → confirmed/failed), receipt with per-seat prices and a reference code.
- **Dark / light mode**, responsive layout, guest checkout — no auth friction for the demo.

## The interesting part: how concurrency is actually handled

Ticketing is the textbook race-condition scenario. The naive implementation reads seat availability, then writes a booking — and under load, two requests both read "available" and both win. SeatFlow closes that window with four cooperating mechanisms.

### 1. Pessimistic row locking (`SELECT … FOR UPDATE`)

Every state transition (hold, confirm) opens a PostgreSQL transaction and **locks the seat rows first**, before checking their status:

```ts
// src/lib/reservation.ts — inside prisma.$transaction
const locked = await tx.$queryRaw<LockedSeatRow[]>(Prisma.sql`
  SELECT id, status, price_cents
  FROM "Seat"
  WHERE id IN (${Prisma.join(seatIds)}) AND event_id = ${input.eventId}
  ORDER BY id
  FOR UPDATE
`);
```

- The **second** transaction on the same seats blocks on the lock until the first commits, then re-reads the row and sees `HELD` → typed `409 SEATS_UNAVAILABLE`. No stale reads, no retry loops.
- Locks are acquired in deterministic `ORDER BY id` order, so concurrent holds on overlapping seat sets can't deadlock.
- The whole check-then-act sequence is atomic: either all requested seats are held, or the transaction rolls back and *nothing* changes.

### 2. Holds are leases, not reservations (TTL)

A hold writes `status = HELD`, an opaque `hold_token` and `held_until = now + 5 min`. Abandoned holds can't squat on inventory because expiry is enforced **three independent ways**:

1. a BullMQ delayed job scheduled the moment the hold is created (`TTL + 5 s` skew buffer),
2. `POST /api/bookings/release-expired` — a cron-safe bulk sweep,
3. a lazy sweep piggybacked on seat-map fetches and hold attempts, so the map self-heals even if the worker is down.

All three release paths are idempotent: they only touch rows that are still `HELD` *and* still carry the hold token.

### 3. Idempotency keys at checkout

The client generates one key per checkout session and sends it (as the `Idempotency-Key` header) on every attempt. Server-side:

- same key seen before → **return the original booking** (200 replay, no new rows, no second charge),
- same key with different hold data → `409 IDEMPOTENCY_CONFLICT`,
- the replay check runs *again inside* the transaction after acquiring the locks, closing the twin-request race between the fast-path lookup and the write.

### 4. Payments run in a queue — with retries *and* compensation

Checkout commits a `PENDING` booking plus `BOOKED` seats, then enqueues a BullMQ job. The worker simulates a gateway (2 s latency, 15% random decline) with **3 attempts / exponential backoff (2 s → 4 s → 8 s)**. On the final failure it runs the compensation transaction: guarded by `WHERE status = 'PENDING'` (so it can never unwind a confirmed sale), it flips the booking to `FAILED` and releases its seats for resale. A success flips the booking to `CONFIRMED` with the same guarded transition, making duplicate job deliveries harmless.

### The full sequence

```text
 Client                API (reservation.ts)           PostgreSQL           Redis/BullMQ            Worker
   │                         │                            │                     │                     │
   │  POST /events/:id/hold  │                            │                     │                     │
   ├────────────────────────►│ BEGIN                      │                     │                     │
   │                         │ SELECT … FOR UPDATE    ───►│                     │                     │
   │                         │  (blocks 2nd buyer here)   │                     │                     │
   │                         │ all AVAILABLE?  ──no──► 409 SEATS_UNAVAILABLE     │                     │
   │                         │ seats → HELD (TTL 5 min)   │                     │                     │
   │                         │ COMMIT                     │                     │                     │
   │                         │ schedule release job ──────────────────────────►│ ───────────────────►│ (TTL + 5 s)
   │◄── holdToken, expiresAt ┤                            │                     │                     │
   │                         │                            │                     │                     │
   │  POST /bookings/confirm │  (Idempotency-Key header)  │                     │                     │
   ├────────────────────────►│ key seen before? ──yes──► 200 (original booking, no new rows)       │
   │                         │ BEGIN · SELECT … FOR UPDATE                       │                     │
   │                         │ HELD by token & not expired?                    │                     │
   │                         │   ├── no, expired ──► 410 HOLD_EXPIRED          │                     │
   │                         │   └── yes: Booking(PENDING) + seats → BOOKED    │                     │
   │                         │ COMMIT                     │                     │                     │
   │                         │ enqueue "payments" ────────────────────────────►│ ─── deliver job ───►│
   │◄── bookingId (201) ─────┤                            │                     │  charge (mock 2 s)  │
   │                         │                            │                     │  fail? retry ×3     │
   │  GET /bookings/:id      │                            │                     │  (2 s → 4 s → 8 s)  │
   ├────────────────────────►│  …polled every 2 s…        │                     │                     │
   │◄── CONFIRMED / FAILED ──┤◄── guarded status update ──┤◄── compensation ───────────────────────────┤
   │     (booking page)      │   (CONFIRMED, or FAILED + seats → AVAILABLE for resale)          │
```

**Net effect:** overlapping holds serialize at the database, a hold can be lost but never stolen, checkout retries converge on one booking, and failed payments heal themselves by returning seats to the pool.

## Architecture

```text
┌───────────────────────────────┐
│           Browser             │
│  /  /events/[id]  /checkout   │
│  /bookings/[id]               │
└───────────────┬───────────────┘
                │ REST · JSON (zod-validated)
┌───────────────▼───────────────┐        ┌────────────────────────────────┐
│   Next.js 16 · App Router     │        │        PostgreSQL 16           │
│                               │        │                                │
│   /api/events                 │        │   Event · Seat · Booking       │
│   /api/events/[id]/hold ──────┼───────►│   BookingSeat                  │
│   /api/holds/[token]          │ Prisma │                                │
│   /api/bookings/confirm       │        │   state machine on Seat:       │
│   /api/bookings/[id]          │        │   AVAILABLE ⇄ HELD → BOOKED    │
│   /api/bookings/release-expired        │   (guarded by FOR UPDATE)      │
└───────────────┬───────────────┘        └────────────────────────────────┘
                │ reservation engine
                │ (src/lib/reservation.ts)
                │
┌───────────────▼───────────────┐        ┌────────────────────────────────┐
│          Redis 7              │        │   worker/worker.ts (tsx)       │
│                               │        │                                │
│   "payments"      queue ──────┼───────►│   charge mock gateway          │
│   "hold-expiry"   queue ──────┼───────►│   retry ×3 · exponential       │
│                               │        │      confirm /    fail + release │
└───────────────────────────────┘        └────────────────────────────────┘
```

## Tech stack

| Layer      | Choice                      | Why                                  |
| ---------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| Framework    | Next.js 16 (App Router) + TypeScript (strict)   | One codebase for UI + API routes, typed end-to-end           |
| Styling     | Tailwind CSS v4 + lucide-react          | Utility-first, no component library lock-in              |
| Database     | PostgreSQL 16 via Prisma ORM           | Relational integrity + `SELECT … FOR UPDATE` row locks         |
| Validation    | Zod                        | Every API input parsed and validated at the boundary          |
| Queues      | BullMQ + ioredis                 | Delayed hold-expiry jobs, retry/backoff semantics for payments     |
| State (client)  | Zustand                      | Minimal store for seat selection                    |
| Worker runtime  | tsx                        | Type-safe standalone worker process, no build step           |
| CI / packaging  | GitHub Actions · Docker (multi-stage) · Compose  | Typecheck + lint on every PR; reproducible local infra         |

## Getting started

Prerequisites: **Node.js ≥ 20** and **Docker** (for Postgres + Redis).

```bash
# 1 — infrastructure (Postgres 16 + Redis 7, with healthchecks)
docker compose up -d

# 2 — install & configure
npm install
cp .env.example .env          # defaults match docker-compose.yml

# 3 — database
npm run db:push               # create tables from prisma/schema.prisma
npm run db:seed               # 2 events × 100 seats (sections A & B)

# 4 — run the app…
npm run dev                   # http://localhost:3000

# 5 — …and the payment worker in a second terminal
npm run worker
```

Then: open an event → pick seats → **Hold seats** → complete the mock checkout → watch the booking page flip from *processing* to *confirmed*.

**To demo the failure path**, leave `FORCE_PAYMENT_SUCCESS="false"` (default): ~15% of payments fail randomly and you can watch the worker retry (2 s → 4 s → 8 s) and finally release the seats. Set `FORCE_PAYMENT_SUCCESS="true"` in `.env` for a flawless recorded demo.

>The app still starts without Redis — only hold/confirm then fail with a clear error. Browse, seat maps and expiry sweeps keep working.

### Handy curl checks

```bash
# release every expired hold (what your cron would call every minute)
curl -X POST http://localhost:3000/api/bookings/release-expired

# confirm is idempotent — run twice, get the same booking twice
curl -X POST http://localhost:3000/api/bookings/confirm \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: my-one-per-checkout-key" \
  -d '{"holdToken":"<token>","customerName":"Ada Lovelace","customerEmail":"ada@example.com","cardNumber":"4242 4242 4242 4242","cardExpiry":"12/28","cardCvc":"123"}'
```

## Environment variables

| Variable        | Required | Default                         | Purpose                              |
| ----------------------- | -------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`     |    | —                            | PostgreSQL connection string used by Prisma            |
| `REDIS_URL`       |    | `redis://localhost:6379`                 | Redis connection for BullMQ (payment + hold-expiry queues)     |
| `FORCE_PAYMENT_SUCCESS` | —    | `false`                         | `true` disables the 15% random gateway decline (for demos)     |
| `CRON_SECRET`      | —    | *(unset)*                        | When set, `POST /api/bookings/release-expired` requires `x-cron-secret: <value>` |

## Project structure

```text
seatflow/
├── prisma/
│   ├── schema.prisma          # Event · Seat · Booking · BookingSeat (+ enums)
│   └── seed.ts                # 2 events, sections A & B (5 rows × 10 seats each)
├── worker/
│   └── worker.ts              # BullMQ worker: payments + hold-expiry, graceful shutdown
├── src/
│   ├── app/
│   │   ├── page.tsx           # events grid
│   │   ├── events/[id]/       # interactive seat map
│   │   ├── checkout/          # countdown + idempotent guest checkout
│   │   ├── bookings/[id]/     # polling status page with stepper
│   │   └── api/               # REST endpoints (zod-validated route handlers)
│   ├── components/            # seat map, header, cards, status view, theme toggle
│   ├── lib/
│   │   ├── reservation.ts     #    the concurrency engine (locking, holds, idempotency)
│   │   ├── queue.ts           # BullMQ producers (lazy, build-safe)
│   │   ├── errors.ts          # typed errors → HTTP codes
│   │   ├── http.ts            # zod body parsing + error funnel
│   │   ├── validation.ts      # request schemas
│   │   ├── serializers.ts     # Prisma → DTO mappers
│   │   └── db.ts              # Prisma client singleton
│   ├── stores/                # zustand (seat selection)
│   └── types/api.ts           # shared DTO contract
├── .github/workflows/ci.yml   # typecheck + lint on every push/PR
├── Dockerfile                 # multi-stage, standalone Next.js output
└── docker-compose.yml         # postgres:16-alpine + redis:7-alpine
```

## Roadmap

Graded by how much systems-design muscle each step demonstrates:

1. **Stripe PaymentIntents + webhooks** — replace the mock gateway; idempotency keys map 1:1 onto Stripe's, and webhook verification adds a second delivery channel to reconcile.
2. **Auth + booking history** — NextAuth (email magic link), per-customer booking list, "my tickets" page.
3. **Rate limiting on `POST /api/events/[id]/hold`** — token bucket per IP/user in Redis to stop hold-flooding attacks before they reach Postgres.
4. **Admin dashboard** — per-event revenue, hold conversion funnel, booked-seat heatmap, manual refund + re-open actions.
5. **Waitlist for sold-out events** — notify on released seats (the compensation path already feeds it).
6. **Playwright e2e stress test** — "100 parallel holds on the last seat → exactly 1 succeeds, 99 get `409`", plus a payment-failure snapshot of the compensation path.
7. **Email receipts** — transactional email on `CONFIRMED` / `FAILED` transitions (worker already has the hook point).

## License

[MIT](./LICENSE) © 2025 Negar Shojaei
