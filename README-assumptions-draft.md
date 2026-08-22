## Assumptions & Scale

The brief describes a single local ecommerce store, so I sized the system for that
rather than for a hypothetical platform. Stating this explicitly because the scale
assumption is what justifies most of the decisions below — including the things I
chose *not* to build.

**Assumed load**

| | |
|---|---|
| Orders per day (single store, post-"boom") | ~1,000 |
| Average sustained rate | ~0.01 orders/sec |
| Flash-sale burst | ~20 orders/sec for a few minutes |
| Achievement evaluations per order | 1 |
| Cashback payouts per day | tens, not thousands |

This is a small system. A single Postgres instance and one queue worker absorb it
with orders of magnitude of headroom.

**Where the actual difficulty is**

Throughput is not the constraint here. Two things are, and both bite at *any* volume:

1. **Concurrency correctness.** Two purchases committing simultaneously must not
   unlock the same achievement twice, and must not trigger two cashbacks for one
   badge. This is a problem with two concurrent requests, not two thousand.
2. **Third-party payment reliability.** The provider call is slow, occasionally
   fails, and can fail *ambiguously* — a timeout may mean the transfer succeeded.
   Retries have to be safe by construction.

The design therefore optimises for correctness and idempotency, not for scale.

**Decisions that follow**

- **Event handlers run on a queue**, not in the HTTP request path. Not for
  throughput — so that a payment-provider outage can't fail a customer's checkout,
  and so failed payouts retry with backoff instead of being lost.
- **Unique constraint on `(user_id, achievement_id)`** and on
  `(user_id, badge_id)`. The database, not application logic, is the authority on
  "unlocked exactly once". Concurrent unlocks collide at the constraint and the
  loser is a no-op.
- **Achievement evaluation is O(1) per purchase** — a maintained counter on the
  user, incremented in the same transaction as the order, rather than a
  `COUNT(*)` over order history. At this volume either works; the counter is the
  same effort and doesn't degrade if this is ever rolled out across many stores.
- **Cashback dispatch is idempotent**, keyed on `(user_id, badge_id)` with a
  persisted payout record and provider reference. A retried job after an ambiguous
  timeout reconciles against the existing record instead of paying twice.
- **Achievements and badges are data-driven**, defined in configuration rather than
  in code branches, so adding a new tier is a config change plus a migration — no
  handler rewrites.

**Deliberately not built**

At this scale these would be cost without benefit, and I'd rather name them than
have their absence read as an oversight:

- No dedicated message broker (Kafka / RabbitMQ) — the framework's Redis-backed
  queue is sufficient and operationally far cheaper.
- No event sourcing or CQRS. The achievements endpoint reads directly from the
  same tables; there is no read model to keep in sync.
- No caching layer on `users/{user}/achievements`. The query is a handful of
  indexed lookups.
- No read replicas, sharding, or partitioning.

**What would change at ~100x**

If this went platform-wide across all merchants: move payment dispatch to a
transactional outbox so the payout record and the enqueue commit atomically; batch
payouts to the provider rather than one transfer per badge; and give payments a
dedicated worker pool so a provider slowdown can't starve achievement processing.
None of that is justified by the load described in the brief.

**Scope**

Out of scope, called out explicitly: refunds and cancellations do not revoke
achievements or claw back cashback. Handling that properly needs a product
decision (partial revocation? negative-balance handling?) rather than a technical
one, so I've left it out and noted it here.
