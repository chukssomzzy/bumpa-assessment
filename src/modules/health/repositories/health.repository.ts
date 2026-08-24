import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

@Injectable()
export class HealthRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  /** A cheap round trip that proves Postgres answers; the result itself is never inspected. */
  async ping(): Promise<void> {
    await this.txHost.tx.query('SELECT 1');
  }
}
