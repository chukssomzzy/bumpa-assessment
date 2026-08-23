# CONTEXT.md

Terse contract for working in this repo. See `README.md` for the product/architecture writeup.

## Stack

NestJS 11, TypeORM (Postgres), BullMQ (Redis), Zod-validated config, nestjs-pino for structured
logs, Jest for all three test tiers. Node 24, npm (no yarn/pnpm).

## Commands & traps

- `npm test` — unit (`src/**/*.spec.ts`). `npm run test:integration` — real Postgres/Redis via
  Testcontainers, `--runInBand` (don't parallelize; they share containers). `npm run test:e2e` —
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
`<name>.controller.ts`, `entities/`. Achievements additionally has `domain/` — pure functions
(`evaluate.ts`, `badge.ts`, `next-available.ts`) with no NestJS or TypeORM imports, unit-tested in
isolation. When achievement/badge rules change, change `domain/` first; the service is a thin
orchestration layer around it (transaction, repositories, event emission).

`src/core.module.ts` holds what both runtime roles share: config, TypeORM connection, BullMQ
connection, structured logging. `src/common/` holds cross-cutting code with no natural module home
(the exception filter, queue job constants, the worker heartbeat).

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

## The three test tiers

- **Unit** (`src/**/*.spec.ts`, `npm test`): pure functions and anything mockable without a real
  Nest app — `domain/`, the exception filter (mocked `ArgumentsHost`/`HttpAdapterHost`, no boot).
  Fast, no I/O.
- **Integration** (`test/integration/*.spec.ts`, `npm run test:integration`): real Postgres +
  Redis via Testcontainers, `TestAppModule` (api + worker graphs combined), HTTP via `supertest`.
  This is where queue draining, concurrency, and the HMAC boundary are exercised.
- **E2E** (`test/e2e/*.spec.ts`, `npm run test:e2e`, manual workflow only): a real `docker compose`
  stack with real Paystack credentials. Not run in normal CI.

New tests belong in the lowest tier that can actually exercise the behaviour — domain logic in
unit, anything touching Postgres/Redis/HTTP wiring in integration.
