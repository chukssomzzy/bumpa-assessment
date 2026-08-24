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
  "unlocked_achievements": ["First Purchase", "5 Purchases"],
  "next_available_achievements": ["10 Purchases"], // only the next tier per group
  "current_badge": "Beginner",
  "next_badge": "Intermediate",
  "remaining_to_unlock_next_badge": 2,
}
```

### `POST /events`

Signed webhook ingest. Verifies an HMAC-SHA512 signature over `{timestamp}.{rawBody}`, checks the
timestamp is within a freshness window, then acknowledges with `202` and hands the work to a queue.
The timestamp is inside the signed payload deliberately: signing the body alone would leave the
replay window unauthenticated, since an attacker could rewrite `x-timestamp` and the signature would
still verify.

### `POST /webhooks/paystack`

Paystack's transfer notifications. Verifies an HMAC-SHA512 signature over the **raw body alone** in
`x-paystack-signature` — a different scheme from `/events`, because Paystack sends no timestamp
header to bind. Both schemes are expressed as data against one verifier
(`src/common/security/hmac.ts`), which fails closed: with no `PAYSTACK_SECRET_KEY` configured it
rejects everything rather than accepting an empty-keyed digest.

Answers `200` for any signed request, whatever the payload turns out to be. A non-2xx makes Paystack
redeliver, so refusing an event we have no use for would buy an unbounded retry loop and change
nothing. Events for a transfer we recognise re-drive that payout through the same `requeue` path the
sweeper uses.

**This endpoint is a latency optimisation, never a correctness dependency.** The worker reconciles by
reference on its own next run and the sweeper re-drives whatever is left; drop every webhook and
payouts still settle, just later. Nothing may be added here that only the webhook can do.

### `GET /health` and `GET /health/ready`

Liveness and readiness. `/health` is dependency-free and cheap enough for a container probe;
`/health/ready` checks Postgres and Redis and returns `503` with a per-dependency breakdown when
either is down. Both are used as Docker healthchecks.

### Errors

Failures return a consistent envelope. Success payloads are deliberately **not** wrapped, because the
achievements response shape is part of the specified contract:

```json
{ "success": false, "statusCode": 401, "message": "Unauthorized" }
```

### Domain events

| Event                 | Payload                                    |
| --------------------- | ------------------------------------------ |
| `AchievementUnlocked` | `achievement_name` (string), `user` (User) |
| `BadgeUnlocked`       | `badge_name` (string), `user` (User)       |

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

**The payout row is the outbox.** Committing a badge and _then_ enqueueing its payout has a gap: die
in between, and the retry finds the badge already unlocked, emits nothing, and exits clean — a
silently lost cashback with nothing in the DLQ. So the `payouts` row is written `pending` inside the
same transaction as the badge. The invariant is enforced by the schema rather than by control flow,
and a cron sweeper reclaims anything still pending after five minutes. This is a transactional
outbox specialised to payouts: same guarantee, no second table and no relay process.

**Badges are count thresholds.** The brief's prose mentions _"sets of achievements"_, but the worked
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

|                              |                                  |
| ---------------------------- | -------------------------------- |
| Orders per day (post-"boom") | ~1,000                           |
| Sustained rate               | ~0.01 orders/sec                 |
| Flash-sale burst             | ~20 orders/sec for a few minutes |
| Cashback payouts per day     | tens                             |

This is a small system; one Postgres and one worker absorb it with orders of magnitude of headroom.
**Throughput is therefore not the design constraint.** Two things are, and both bite at any volume:

1. **Concurrency correctness** — simultaneous purchases must not double-unlock an achievement or
   pay a badge twice. That is a problem with two concurrent requests, not two thousand.
2. **Third-party reliability** — the provider call is slow, occasionally fails, and can fail
   _ambiguously_: a timeout may mean the transfer already succeeded.

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

1. **An event is processed at most once.** The `processed_events` insert happens _inside_ the
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

| Customer  | Id                                     |
| --------- | -------------------------------------- |
| Ada Demo  | `11111111-1111-4111-8111-111111111111` |
| Bola Demo | `22222222-2222-4222-8222-222222222222` |

```bash
USER=11111111-1111-4111-8111-111111111111
SECRET=$(grep '^WEBHOOK_SECRET=' .env | cut -d= -f2-)
TS=$(date +%s)
BODY="{\"type\":\"purchase.completed\",\"eventId\":\"evt-$TS\",\"userId\":\"$USER\",\"occurredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"

# The signature covers "{timestamp}.{body}" -- signing the body alone would leave
# the freshness window unauthenticated and the request replayable forever.
SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha512 -hmac "$SECRET" -r | cut -d' ' -f1)

curl -X POST http://localhost:3000/events \
  -H "content-type: application/json" \
  -H "x-signature: $SIG" \
  -H "x-timestamp: $TS" \
  -d "$BODY"

curl http://localhost:3000/users/$USER/achievements
```

Repeat the POST with a fresh `eventId` to advance the counter; the fifth purchase unlocks
"5 Purchases". Re-sending the _same_ `eventId` is a no-op, by design.

---

## Configuration

| Variable                     | Purpose                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`               | Postgres connection string                                       |
| `REDIS_URL`                  | Redis connection string for BullMQ                               |
| `WEBHOOK_SECRET`             | Shared secret for HMAC verification on `POST /events`            |
| `PAYSTACK_SECRET_KEY`        | Paystack API key — use a `sk_test_…` key                         |
| `PAYMENT_PROVIDER`           | `paystack` or `fake` (default `fake` in test)                    |
| `CASHBACK_AMOUNT_KOBO`       | Cashback per badge, default `30000` (₦300)                       |
| `PAYOUT_MAX_ATTEMPTS`        | Attempts before a payout goes terminal `failed`                  |
| `PAYOUT_STALE_AFTER_SECONDS` | Re-drive payouts left pending longer than this                   |
| `WEBHOOK_TOLERANCE_SECONDS`  | Freshness window for `POST /events`, default `300`               |
| `CLOUDFLARE_TUNNEL_TOKEN`    | Only for `--profile tunnel`; see Receiving real webhooks locally |

Paystack test-mode transfers return success immediately without moving funds, so the real adapter is
exercisable end to end against test keys.

---

## Running tests

```bash
npm test                  # unit — pure domain logic, no I/O
npm run test:bdd          # Testcontainers: real Postgres + Redis
npm run test:e2e          # end-to-end against the composed stack
npm run test:cov          # coverage of the domain layer
```

Three tiers, deliberately separated:

| Tier       | Covers                                                | Runs on push         |
| ---------- | ----------------------------------------------------- | -------------------- |
| `test`     | Pure rules functions, no I/O                          | yes                  |
| `test:bdd` | Repositories, processors, sweeper, concurrency        | yes                  |
| `test:e2e` | The composed stack over HTTP, real provider test keys | no — manual dispatch |

Integration tests run against **real** Postgres and Redis rather than sqlite or mocks, because the
design rests on three Postgres behaviours — an exclusive row lock, `ON CONFLICT DO NOTHING`, and a
per-group ordering query. Testing against anything else would test the ORM, not the design. Docker
must be running; the first run pulls images. They boot a module graph containing both producers and
processors, so enqueued work is consumed in-process — production keeps those graphs apart.

What the suite covers:

| Scenario                         | Asserts                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| Concurrent purchases             | N simultaneous events for one user → exactly one badge, exactly one payout          |
| Duplicate delivery               | Same `event_id` twice → counter incremented once                                    |
| Crash between commit and enqueue | Sweeper reclaims the pending payout                                                 |
| Provider failure                 | Retries with backoff, then lands terminal `failed`                                  |
| Ambiguous timeout                | Reconciles by `reference`, never double-pays                                        |
| HMAC guard                       | Bad signature, stale timestamp and replayed body all rejected                       |
| Threshold & badge maths          | Each tier unlocks at exactly its count; `remaining_to_unlock_next_badge` is correct |
| Per-group selection              | Only the lowest un-earned tier per group is returned                                |
| Endpoint edges                   | Brand-new user; top-tier user (`next_badge` null, remaining 0)                      |
| Full path                        | Events in → achievements, badge and payout out → endpoint reflects it               |

---

## Receiving real webhooks locally

Paystack cannot reach a laptop. The `tunnel` compose profile publishes the local api through a named
Cloudflare tunnel so it can:

```bash
# .env needs CLOUDFLARE_TUNNEL_TOKEN from a named tunnel in the Cloudflare Zero Trust dashboard.
# In that tunnel's Public Hostname config, point the service at `api:3000` — cloudflared runs
# inside the compose network, so `localhost` there would be the cloudflared container itself.
docker compose --profile tunnel up -d --wait

# Or set COMPOSE_PROFILES=tunnel in .env and a plain `docker compose up -d --wait` includes it.
```

Without the profile the stack runs exactly as before and needs no Cloudflare account. Compose's
required-variable syntax (`${VAR:?message}`) is _not_ profile-aware — interpolation happens before
profiles are filtered — so the token requirement is enforced by a `tunnel-preflight` container that
fails the `up` with a message naming the variable. cloudflared's own image ships no shell, and its
unaided error ("requires the ID or name of the tunnel") points at the wrong thing entirely.

Then, in the Paystack dashboard, register the tunnel hostname as the **test-mode** webhook URL
pointing at `/webhooks/paystack`, and **disable OTP for transfers** — with OTP on, a transfer returns
`otp`, never completes, and no webhook is ever emitted:

```bash
curl -X POST https://api.paystack.co/transfer/disable_otp \
  -H "Authorization: Bearer $PAYSTACK_SECRET_KEY"
curl -X POST https://api.paystack.co/transfer/disable_otp_finalize \
  -H "Authorization: Bearer $PAYSTACK_SECRET_KEY" -H "Content-Type: application/json" \
  -d '{"otp":"<code Paystack sends you>"}'
```

`test/e2e/payout-webhook.e2e.spec.ts` then waits for a webhook Paystack genuinely delivers. It
asserts on the **receipt row**, never on payout status — status alone would go green via the worker's
own reconcile even with the tunnel completely dead, which is the one failure the test exists to
catch.

---

## Releases & images

Deployment here is building and publishing an image; there is no deploy step.

- **`staging`** is the default branch and the integration target. A push to it publishes
  `ghcr.io/chukssomzzy/bumpa-assessment:staging` and `:sha-<sha>` — but only after lint, typecheck,
  unit and integration jobs pass, so that tag always means "known good".
- **`main`** is production. Promotion is a `staging → main` pull request, and it **must be merged as
  a merge commit, never squashed**: release-please derives the version and changelog by parsing
  individual commit messages, and a squash collapses a whole release into one contentless entry.
- release-please maintains a rolling release PR against `main`. Merging it is the release: it tags
  the repo, and that tag publishes `:v<version>` and `:latest`.

Both callers build through one reusable workflow (`.github/workflows/_publish-image.yml`), so the
staging and production images cannot silently diverge in build args or base image.

**Required repository secrets**

| Secret                                  | Needed by                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RELEASE_PLEASE_TOKEN`                  | `release-please.yml` — see below                                                                                                                                                     |
| `WEBHOOK_SECRET`, `PAYSTACK_SECRET_KEY` | `e2e.yml`                                                                                                                                                                            |
| `CLOUDFLARE_TUNNEL_TOKEN`               | `e2e.yml` — the manual E2E workflow now brings the stack up with `--profile tunnel`, and `tunnel-preflight` fails the `up` without it, taking the non-webhook E2E specs down with it |

**On `RELEASE_PLEASE_TOKEN`:** a fine-grained PAT scoped to this repo with _Contents: write_
and _Pull requests: write_. `GITHUB_TOKEN` will not do: GitHub deliberately fires no workflow
events for anything it creates, so a tag pushed under it would trigger no image build at all. Note
that when this PAT expires, release PRs stop appearing **silently** — there is no in-band failure, so
it needs a calendar reminder.

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
