import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { UserProgressEntity } from '../../users/user-progress.entity';

@Injectable()
export class UserProgressRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  /**
   * Increment-and-read in one statement takes the row lock that serialises
   * concurrent purchases for this user, so no update is ever lost. Written as
   * an upsert so a user without a progress row counts their first purchase
   * rather than crashing on an absent row.
   */
  async incrementPurchaseCount(userId: string): Promise<number> {
    const rows: { purchase_count: number }[] = await this.txHost.tx.query(
      `INSERT INTO user_progress (user_id, purchase_count) VALUES ($1, 1)
       ON CONFLICT (user_id) DO UPDATE SET purchase_count = user_progress.purchase_count + 1
       RETURNING purchase_count`,
      [userId],
    );
    return rows[0].purchase_count;
  }

  /** A user without a progress row (never purchased) reads as zero, not missing. */
  async findPurchaseCount(userId: string): Promise<number> {
    const row = await this.txHost.tx.findOne(UserProgressEntity, { where: { userId } });
    return row?.purchaseCount ?? 0;
  }
}
