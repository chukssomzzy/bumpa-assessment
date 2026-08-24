import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

/**
 * The single dedupe primitive over `processed_events`. Shared by the purchase
 * evaluation transaction (keyed by the event id) and the Paystack webhook
 * (keyed by a derived receipt key) — both are "has this id been seen before"
 * over the same table, so both go through this one method rather than each
 * writing their own insert.
 */
@Injectable()
export class ProcessedEventRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  /**
   * Records `id` as processed if it has not been seen before, and reports
   * whether it was new.
   *
   * RETURNING makes the "already processed" case observable from the row
   * count without a second round trip, and the whole statement is atomic.
   * A query-builder `.orIgnore()` insert plus `result.identifiers.length` is
   * NOT equivalent: `event_id` is a caller-supplied primary key, so TypeORM
   * can populate `identifiers` from the values it was given even when ON
   * CONFLICT silently skipped the row. Only the RETURNING row count is
   * trustworthy here.
   */
  async recordEventIfNew(id: string): Promise<boolean> {
    const rows: { event_id: string }[] = await this.txHost.tx.query(
      'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id',
      [id],
    );
    return rows.length > 0;
  }
}
