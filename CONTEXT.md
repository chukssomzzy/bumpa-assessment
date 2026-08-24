# CONTEXT.md

Terse contract for working in this repo. See `README.md` for the product/architecture writeup.

## Stack

NestJS 11, TypeORM (Postgres), BullMQ (Redis), Zod-validated config, nestjs-pino for structured
logs, Jest for all three test tiers. Node 24, npm (no yarn/pnpm).

## Commands & traps

- `npm test` — unit (`src/**/*.spec.ts`). `npm run test:bdd` (alias: `test:integration`) — real
  Postgres/Redis via Testcontainers, `--runInBand` (don't parallelize; they share containers).
  `npm run test:e2e` —
  manual only, hits a running `docker compose` stack with real provider credentials.
- **Piping any of the above through `tail`/`head`/`grep` hides the real exit code.** Run unpiped.
- Integration tests spin up Docker containers on first run; expect ~10s+ before output starts.
- `npm ci` needs `--ignore-scripts` outside a git checkout (husky's `prepare` hook requires `.git`).
  Both Dockerfile stages already do this — don't remove it, the production stage has no husky.
- `pino-pretty` is a devDependency only. It is resolved at runtime (`require.resolve`) and skipped
  if absent, so a production image booting with the wrong `NODE_ENV` degrades to JSON logs instead
  of crashing — see `src/common/logging/logger.module.ts`.

## Module layout

Each `src/modules/<name>/` is a NestJS feature module: `<name>.module.ts`, `<name>.service.ts`,
`<name>.controller.ts`, `entities/`, `repositories/`. Achievements additionally has `domain/` — pure
functions (`evaluate.ts`, `badge.ts`, `next-available.ts`) with no NestJS or TypeORM imports,
unit-tested in isolation. When achievement/badge rules change, change `domain/` first; the service is
a thin orchestration layer around it (transaction, repositories, event emission).

`src/core.module.ts` holds what both runtime roles share: config, TypeORM connection, BullMQ
connection, structured logging, and the CLS/transaction plugin. `src/common/` holds cross-cutting
code with no natural module home (the exception filter, queue job constants, the worker heartbeat,
the HMAC verifier).

## Persistence goes through repositories

**TypeORM primitives do not appear outside `repositories/`.** No service, controller or processor may
inject a `Repository`, reach for `DataSource`, call `getRepository`, `createQueryBuilder`, or run raw
SQL. `grep -rE "dataSource\.|getRepository\(|createQueryBuilder\(|InjectRepository|manager\.query" src/modules`
should only ever match inside a `repositories/` directory. (`src/database/` is exempt — it is
bootstrap and CLI code, not request-path code.)

Repository methods are named for the domain operation, not the query: `recordEventIfNew`,
`incrementPurchaseCount`, `insertPendingPayoutIfAbsent`. A method that merely forwards its arguments
to `findOne` has bought nothing.

Every repository takes its `EntityManager` from `TransactionHost<TransactionalAdapterTypeOrm>` —
`this.txHost.tx`. That is what makes one method work both inside and outside a transaction: it
resolves to the ambient transactional manager when a `@Transactional()` frame is active, and to the
default manager when none is. **A repository call is therefore only atomic with its neighbours if
some caller up the stack declared `@Transactional()`.**

`AchievementsService.applyPurchaseEvent` is the one place that declares it, and it must stay that
way: dedupe, counter increment, achievement inserts, badge inserts and the payout row are one
transaction or the outbox guarantee below is void. `PayoutsService.dispatch` deliberately does NOT
declare it — it must not hold a database transaction open across the Paystack network call.

The two load-bearing raw statements now live in `achievements/repositories/user-progress.repository.ts`
(the row-locking upsert) and `events/repositories/processed-event.repository.ts` (the dedupe insert).
Both are raw on purpose; see the invariants below before rewriting either as a query builder.

## Two runtime roles, one codebase

`AppModule` (`main.ts`) is the HTTP role: controllers, the exception filter, health endpoints. It
deliberately excludes the queue processors — the API's module graph cannot consume a job, so a
stuck provider call can never block the request event loop.

`WorkerModule` (`main.worker.ts`) is the background role: both `@Processor`s, the payout sweeper,
the heartbeat writer. No HTTP server, no exception filter (there is nothing HTTP to catch for).

Both import `CoreModule`. `test/setup/test-app.module.ts` combines both graphs in one process
because an integration test that posts an event needs something to consume the job.

## Error envelope — and why success responses don't get one

Every error response is shaped by `AllExceptionsFilter`
(`src/common/filters/all-exceptions.filter.ts`) into
`{ success: false, statusCode, message, errors? }`. `errors` is present only for structured detail
(e.g. a validation message array); a plain `NotFoundException` gets no `errors` key at all. 5xx is
logged at `error`; 4xx is expected traffic and logged at nothing.

**Success payloads are never enveloped.** `GET /users/:user/achievements` returns
`{ unlocked_achievements, next_available_achievements, current_badge, next_badge,
remaining_to_unlock_next_badge }` raw — that shape is the graded contract for this assessment, and
a `{ data: ... }` wrapper would break it. Do not add a response-wrapping interceptor.

## Money-path invariants

Read these before touching `payouts` or the evaluate transaction.

- **One payout per badge**, enforced by `UNIQUE(user_id, badge_key)` — not by application logic.
- **A badge cannot exist without a payout row.** Both are written in the same transaction, which is
  what lets the `payouts` table serve as the outbox. No generic outbox table exists.
- **`providerReference` is `{userId}_{badgeKey}` and never changes.** The separator is an
  underscore because Paystack rejects `:` and `.` in a reference with HTTP 400 (verified against the
  live API); a colon strands every payout, since the resulting failed lookup is never terminal. It is the idempotency key and
  the only handle for reconciling an ambiguous transfer. Never overwrite it with a provider-returned
  value.
- **An `unknown` provider outcome is never terminal.** Money may have moved. Reconcile by reference
  before any retry, and reconcile _before_ checking the attempt ceiling — otherwise a transfer that
  actually succeeded gets recorded as failed, and re-driving it double-pays.
- **A retryable failure throws**, so BullMQ's backoff engages. Returning normally completes the job
  and silently leaves recovery to the sweeper alone.
- **The sweeper drops a finished job before re-adding it.** BullMQ ignores `add()` while a job with
  that id exists in any state, and completed jobs are retained — so a plain re-add is a silent no-op
  and strands the payout forever.
- **`dispatch` is a read-modify-write with no row lock.** Safe only because the job id is the payout
  id, so BullMQ gives one consumer at a time, and `maxStalledCount: 0` stops a stalled job being
  re-run alongside the original. Closing this properly would need a lease column and a migration.
- **Dedupe reads the RETURNING row count, never `identifiers`.** `processed_events.event_id` is a
  caller-supplied primary key, so a query-builder `.orIgnore()` insert can report identifiers from
  the values it was given even when `ON CONFLICT` skipped the row. Only `recordEventIfNew`'s row
  count distinguishes a new event from a redelivery — and a wrong answer means every Paystack
  redelivery re-drives the payout, which no test asserting "exactly one receipt row" would catch.
- **The storefront HMAC covers `{timestamp}.{rawBody}`.** Signing the body alone leaves the
  freshness window unauthenticated and the request replayable forever.
- **The Paystack webhook is an optimisation, never a dependency.** It only re-drives an existing
  payout through the same `requeue` path the sweeper uses; the worker still calls `findTransfer`.
  Drop every webhook and the system still settles, just later. Nothing may be added to that handler
  that only the webhook can do.
- **The webhook always answers 2xx once signed.** A non-2xx makes Paystack redeliver, so refusing an
  event we have no use for buys an unbounded retry loop and changes nothing.

## Two signing schemes, one verifier

`src/common/security/hmac.ts` holds the only implementation of the signature comparison. Senders
differ as _data_ (`HmacScheme`), not as duplicated guards:

| Sender     | Header                 | Signed payload       | Freshness |
| ---------- | ---------------------- | -------------------- | --------- |
| Storefront | `x-signature`          | `{timestamp}.{body}` | enforced  |
| Paystack   | `x-paystack-signature` | raw body alone       | none      |

Paystack's `timestamp: false` is not an oversight — it sends no timestamp header. `verifyHmac`
**fails closed**: a scheme with no secret verifies nothing, so a stack booted without
`PAYSTACK_SECRET_KEY` rejects every webhook rather than accepting an empty-keyed digest. The two
schemes must never be interchangeable; `src/common/security/hmac.spec.ts` pins that both ways.

## Test conventions

Every tier is BDD-shaped: `describe('Feature: ...')` → `describe('Scenario: ...')` → `it(...)`, with
`// Given`, `// When`, `// Then` sections inside each test. Unit `it` titles state the outcome; BDD
and e2e `it` titles are full `Given ..., When ..., Then ...` sentences.

The BDD tier hands each spec a `BddWorld` (`test/bdd/support/application/bdd-world.ts`):
`beforeAll(createBddWorld)`, `beforeEach(world.resetScenario)`, `afterEach(world.verifyScenario)`,
`afterAll(world.close)`. **`createBddWorld` is a facade over `app-harness.ts`, not a replacement.**
That harness carries fixes nothing pins: `app.listen(0)` rather than `init()` (supertest's lazy
listen races under concurrency), the `40P01` deadlock retry, `clearQueues` waiting on active jobs,
and the reset → clear → resume ordering. Do not re-derive it.

`verifyScenario()` is intentionally a no-op — there is no outbound stub contract here; the only
outbound boundary is `FakePaymentProvider`, asserted inline via `world.provider.attempted` next to
the behaviour it pins.

Per-feature `fixtures.ts` files hold the `givenX` / `readX` / `expectX` steps. Setup that has to
happen in a particular order lives there with its reasoning, e.g. `givenPendingPayout` pauses the
payout queue _before_ posting purchases, because the worker otherwise settles the row in
milliseconds.

Two deliberate divergences from the reference standard this was modelled on: `maxWorkers: 1` stays
(suites share one Testcontainers pair), and there is no globalSetup/globalTeardown, swagger
transformer or worker-count machinery — those solve problems this repo does not have.

## The three test tiers

- **Unit** (`src/**/*.spec.ts`, `npm test`): pure functions and anything mockable without a real
  Nest app — `domain/`, the exception filter (mocked `ArgumentsHost`/`HttpAdapterHost`, no boot).
  Fast, no I/O.
- **BDD** (`test/bdd/**/*.bdd-spec.ts`, `npm run test:bdd`): real Postgres +
  Redis via Testcontainers, `TestAppModule` (api + worker graphs combined), HTTP via `supertest`.
  This is where queue draining, concurrency, and the HMAC boundary are exercised.
- **E2E** (`test/e2e/*.e2e.spec.ts`, `npm run test:e2e`, manual workflow only): a real `docker compose`
  stack with real Paystack credentials. Not run in normal CI. `payout-webhook.e2e.spec.ts`
  additionally needs `--profile tunnel` and waits on a webhook Paystack genuinely delivers — see its
  header for the four prerequisites. It asserts on the **receipt row**, never on payout status:
  status alone would go green via the worker's own reconcile even with the tunnel dead.

New tests belong in the lowest tier that can actually exercise the behaviour — domain logic in
unit, anything touching Postgres/Redis/HTTP wiring in integration.
