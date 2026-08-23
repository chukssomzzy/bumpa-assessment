# Achievements, Badges & Automated Cashback

A backend service that turns a store's purchase stream into customer segmentation. Purchases unlock **achievements**; accumulated achievements earn a **badge**; every badge earned triggers an automatic **₦300 cashback** to the customer via Paystack.

> **Status:** implementation in progress. The design below is settled and recorded in
> [issue #1](https://github.com/chukssomzzy/bumpa-assessment/issues/1); this README documents the
> architecture and the intended setup. This note is removed once the build is complete.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Design choices](#design-choices)
- [Assumptions & scale](#assumptions--scale)
- [Data model](#data-model)
- [Invariants](#invariants)
- [Setup](#setup)
- [Configuration](#configuration)
- [Running tests](#running-tests)
- [Scope & non-goals](#scope--non-goals)

---

## What it does

The service consumes `purchase.completed` events from the storefront and maintains each user's
progress. Crossing a threshold unlocks an achievement; accumulating enough achievements earns a
badge; earning a badge pays the customer ₦300.

### `GET /users/:user/achievements`

```jsonc
{
  "unlocked_achievements":      ["First Purchase", "5 Purchases"],
  "next_available_achievements": ["10 Purchases"],   // only the next tier per group
  "current_badge":               "Beginner",
  "next_badge":                  "Intermediate",
  "remaining_to_unlock_next_badge": 2
}
```

### `POST /events`

Signed webhook ingest. Verifies an HMAC signature, then acknowledges with `202` and hands the work
to a queue.

### Domain events

| Event | Payload |
|---|---|
| `AchievementUnlocked` | `achievement_name` (string), `user` (User) |
| `BadgeUnlocked` | `badge_name` (string), `user` (User) |

---

## Architecture

```
POST /events                          HMAC guard · stateless · 202
  │  verify signature + timestamp freshness window
  └─ enqueue { jobId: eventId }
                    │
                    ▼             [BullMQ: evaluate]
     ┌── BEGIN ──────────────────────────────────────────┐
     │  insert processed_events (event_id) ON CONFLICT    │ ← authoritative dedupe
     │      DO NOTHING → 0 rows affected? already handled │
     │  increment user_progress.purchase_count            │ ← row lock serialises
     │  insert user_achievements        .orIgnore()       │
     │  insert user_badges              (if crossed)      │
     │  insert payouts  status=pending  UNIQUE(user,badge)│ ← the outbox
     └── COMMIT ─────────────────────────────────────────┘
                    │
       emit AchievementUnlocked / BadgeUnlocked   (EventEmitter2, post-commit)
                    └─ listener enqueues the payout job, does no work itself
                    │
                    ▼             [BullMQ: payout]
              PaymentProvider.ensureRecipient() → transfer()
              retry w/ backoff → succeeded | failed (terminal)

[@Cron 5m] payouts still pending → re-enqueue    ← covers the commit↔enqueue gap
```

Ordering is load-bearing: **commit, then emit.** Listeners only enqueue; they never do work
themselves. A crash in the gap between commit and enqueue is recovered by the sweeper.

---

## Design choices

**Purchases arrive as signed external events, not as an orders API.** The service owns achievement
state, not commerce. That makes the ingest boundary untrusted by definition, which is why dedupe and
signature verification are structural rather than defensive extras.

**Queues at the network boundaries, in-process events for the domain.** BullMQ carries the two hops
that can fail — ingest → evaluate, and the payout call — so a Paystack outage retries with backoff
instead of failing a webhook. `AchievementUnlocked` and `BadgeUnlocked` are ordinary in-process
emissions, which keeps them readable domain code and trivially unit-testable rather than
infrastructure.

**The payout row is the outbox.** Committing a badge and *then* enqueueing its payout has a gap: die
in between, and the retry finds the badge already unlocked, emits nothing, and exits clean — a
silently lost cashback with nothing in the DLQ. So the `payouts` row is written `pending` inside the
same transaction as the badge. The invariant is enforced by the schema rather than by control flow,
and a cron sweeper reclaims anything still pending after five minutes. This is a transactional
outbox specialised to payouts: same guarantee, no second table and no relay process.

**Badges are count thresholds.** The brief's prose mentions *"sets of achievements"*, but the worked
example and the `remaining_to_unlock_next_badge (int)` contract are both count-based. The graded
endpoint wins; the ambiguity is noted here deliberately.

**Achievements are rows, not code.** `achievements(key, name, group_key, metric, threshold, tier)` is
seeded by migration, so adding a tier is one row and zero code. `next_available_achievements` is a
`DISTINCT ON (group_key)` for the lowest un-earned tier — the per-group rule lives in one query
rather than in controller branching.

**Payments sit behind a port.** `PaymentProvider` has a real `PaystackProvider` and an in-memory
fake. The fake is scriptable (success, failure, timeout), so the whole suite runs offline with no API
keys while the real adapter is still exercised against test credentials. Paystack needs a
`recipient_code`, which needs bank details the brief's `User` model doesn't have — so users carry
`bank_code`/`account_number` and the first payout caches the resulting `recipient_code`.

**TypeORM on Postgres.** The concurrency guarantee is a database behaviour: `increment()` issues an
`UPDATE` holding an exclusive row lock until commit, so two evaluate jobs for the same user
serialise on the progress row. Unique constraints are the backstop, not the mechanism.

**An open ingest endpoint would be a mint.** Anyone who found it could loop `purchase.completed` for
their own user id and drain the merchant's Paystack balance ₦300 at a time. HMAC verification is the
boundary that makes the rest of the design safe, not a hygiene checkbox.

---

## Assumptions & scale

Sized for the single store the brief describes. Stated explicitly, because the assumption is what
justifies the decisions above — including what is deliberately absent.

| | |
|---|---|
| Orders per day (post-"boom") | ~1,000 |
| Sustained rate | ~0.01 orders/sec |
| Flash-sale burst | ~20 orders/sec for a few minutes |
| Cashback payouts per day | tens |

This is a small system; one Postgres and one worker absorb it with orders of magnitude of headroom.
**Throughput is therefore not the design constraint.** Two things are, and both bite at any volume:

1. **Concurrency correctness** — simultaneous purchases must not double-unlock an achievement or
   pay a badge twice. That is a problem with two concurrent requests, not two thousand.
2. **Third-party reliability** — the provider call is slow, occasionally fails, and can fail
   *ambiguously*: a timeout may mean the transfer already succeeded.

### Deliberately not built

Named so their absence reads as a decision rather than an oversight: no message broker
(Kafka/RabbitMQ) — Redis-backed queues are sufficient and far cheaper to operate; no event sourcing
or CQRS; no cache on the read endpoint, which is a handful of indexed lookups; no read replicas,
sharding or partitioning.

### What would change at ~100x

Promote the payout-specific outbox to a generic one if `AchievementUnlocked` ever needs an external
consumer; batch provider transfers rather than one per badge; give payments a dedicated worker pool
so a provider slowdown cannot starve achievement evaluation. None of it is justified by the load
described in the brief.

---

## Data model

```
users              id, name, email, bank_code, account_number, recipient_code
user_progress      user_id PK, purchase_count            ← derived from the event stream
achievements       key, name, group_key, metric, threshold, tier      [seeded]
badges             key, name, required_achievement_count              [seeded]
user_achievements  user_id, achievement_key    UNIQUE(user_id, achievement_key)
user_badges        user_id, badge_key          UNIQUE(user_id, badge_key)
payouts            user_id, badge_key, amount_kobo, status,
                   provider_reference, attempts
                                               UNIQUE(user_id, badge_key)
processed_events   event_id PK, processed_at
```

Seeded definitions:

```
achievements
 key            name              group     metric          threshold  tier
 first_purchase "First Purchase"  purchases purchase_count      1        1
 five_purchases "5 Purchases"     purchases purchase_count      5        2
 ten_purchases  "10 Purchases"    purchases purchase_count     10        3

badges           Beginner 0 · Intermediate 4 · Advanced 8 · Elite 12
```

Because the service does not own an orders table, `purchase_count` is derived state maintained from
the event stream — which makes its correctness a first-class concern rather than a cache.

---

## Invariants

1. **An event is processed at most once.** The `processed_events` insert happens *inside* the
   evaluate transaction, not at HTTP time. Ingest stays stateless so that a crash before enqueue is
   recoverable by the producer's retry — were ingest to write the dedupe row first, that retry would
   be swallowed and the purchase lost permanently. BullMQ `jobId = eventId` collapses duplicate
   deliveries cheaply, but is not authoritative: completed jobs are evicted and stop colliding.
2. **A badge is awarded at most once, and paid at most once** — `UNIQUE(user_id, badge_key)` on both
   `user_badges` and `payouts`.
3. **A badge cannot exist without a payout row** — both are inserted in the same transaction.
4. **The threshold-0 badge is initial state.** `Beginner` is assigned at user creation with no event
   and no payout; otherwise every new user would be paid ₦300 for doing nothing. `current_badge` is
   consequently never null, matching its `string` type in the contract.
5. **Concurrent purchases serialise per user** on the `user_progress` row lock.

Money is stored as **integer kobo** throughout (₦300 = `30000`). No floats anywhere.

---

## Setup

Requires Docker. Nothing else is needed locally.

```bash
cp .env.example .env     # then set PAYSTACK_SECRET_KEY and WEBHOOK_SECRET
docker compose up --build
```

Compose brings up five services: `postgres`, `redis`, a one-shot `migrate` (runs migrations and
seeds, then exits), `api`, and `worker`. The two app services share one image and differ only by
command — `api` serves HTTP, `worker` runs both queue processors plus the cron sweeper. Both wait on
`migrate` completing successfully, so boot order is explicit rather than racy.

The API is then on `http://localhost:3000`.

### Sending a test purchase

The seed creates two demo customers with test bank details, so this runs on a clean checkout:

| Customer | Id |
|---|---|
| Ada Demo | `11111111-1111-4111-8111-111111111111` |
| Bola Demo | `22222222-2222-4222-8222-222222222222` |

```bash
USER=11111111-1111-4111-8111-111111111111
SECRET=$(grep '^WEBHOOK_SECRET=' .env | cut -d= -f2-)
BODY="{\"type\":\"purchase.completed\",\"eventId\":\"evt-$(date +%s)\",\"userId\":\"$USER\",\"occurredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
SIG=$(printf '%s' "$BODY" | openssl dgst -sha512 -hmac "$SECRET" -r | cut -d' ' -f1)

curl -X POST http://localhost:3000/events \
  -H "content-type: application/json" \
  -H "x-signature: $SIG" \
  -H "x-timestamp: $(date +%s)" \
  -d "$BODY"

curl http://localhost:3000/users/$USER/achievements
```

Repeat the POST with a fresh `eventId` to advance the counter; the fifth purchase unlocks
"5 Purchases". Re-sending the *same* `eventId` is a no-op, by design.

---

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string for BullMQ |
| `WEBHOOK_SECRET` | Shared secret for HMAC verification on `POST /events` |
| `PAYSTACK_SECRET_KEY` | Paystack API key — use a `sk_test_…` key |
| `PAYMENT_PROVIDER` | `paystack` or `fake` (default `fake` in test) |
| `CASHBACK_AMOUNT_KOBO` | Cashback per badge, default `30000` (₦300) |
| `PAYOUT_MAX_ATTEMPTS` | Attempts before a payout goes terminal `failed` |

Paystack test-mode transfers return success immediately without moving funds, so the real adapter is
exercisable end to end against test keys.

---

## Running tests

```bash
npm test                  # unit — pure domain logic, no I/O
npm run test:integration  # Testcontainers: real Postgres + Redis
npm run test:e2e          # end-to-end against the composed stack
npm run test:cov          # coverage of the domain layer
```

Three tiers, deliberately separated:

| Tier | Covers | Runs on push |
|---|---|---|
| `test` | Pure rules functions, no I/O | yes |
| `test:integration` | Repositories, processors, sweeper, concurrency | yes |
| `test:e2e` | The composed stack over HTTP, real provider test keys | no — manual dispatch |

Integration tests run against **real** Postgres and Redis rather than sqlite or mocks, because the
design rests on three Postgres behaviours — an exclusive row lock, `ON CONFLICT DO NOTHING`, and a
per-group ordering query. Testing against anything else would test the ORM, not the design. Docker
must be running; the first run pulls images. They boot a module graph containing both producers and
processors, so enqueued work is consumed in-process — production keeps those graphs apart.

What the suite covers:

| Scenario | Asserts |
|---|---|
| Concurrent purchases | N simultaneous events for one user → exactly one badge, exactly one payout |
| Duplicate delivery | Same `event_id` twice → counter incremented once |
| Crash between commit and enqueue | Sweeper reclaims the pending payout |
| Provider failure | Retries with backoff, then lands terminal `failed` |
| Ambiguous timeout | Reconciles by `reference`, never double-pays |
| HMAC guard | Bad signature, stale timestamp and replayed body all rejected |
| Threshold & badge maths | Each tier unlocks at exactly its count; `remaining_to_unlock_next_badge` is correct |
| Per-group selection | Only the lowest un-earned tier per group is returned |
| Endpoint edges | Brand-new user; top-tier user (`next_badge` null, remaining 0) |
| Full path | Events in → achievements, badge and payout out → endpoint reflects it |

---

## Scope & non-goals

- **Refunds and cancellations do not revoke achievements or claw back cashback.** Handling that
  properly needs a product decision — partial revocation? negative balances? — rather than a
  technical one, so it is excluded deliberately.
- **`GET /users/:user/achievements` is unauthenticated.** In the real platform it would sit behind
  the existing session auth; inventing a login the brief never asked for would spend the budget in
  the wrong place. The ingest endpoint, which is the one that moves money, is signed.
- **Unknown `user_id` on ingest returns 422** rather than auto-creating, since bank details are
  required before anyone can be paid.
- **Payouts are terminal after `PAYOUT_MAX_ATTEMPTS`.** A user with an invalid account number must
  not retry forever; the row lands in `failed` and awaits intervention.
