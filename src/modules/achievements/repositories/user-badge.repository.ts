import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { UserBadgeEntity } from '../entities/user-badge.entity';

@Injectable()
export class UserBadgeRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async listEarnedKeys(userId: string): Promise<string[]> {
    const rows = await this.txHost.tx.find(UserBadgeEntity, { where: { userId } });
    return rows.map((row) => row.badgeKey);
  }

  /**
   * Inserts newly earned badges. `orIgnore` makes this safe to call with a
   * badge the user already holds, which should never happen given the
   * evaluation logic but costs nothing to guard against at the write.
   */
  async insertNewBadges(userId: string, badgeKeys: string[]): Promise<void> {
    if (badgeKeys.length === 0) return;
    await this.txHost.tx
      .createQueryBuilder()
      .insert()
      .into(UserBadgeEntity)
      .values(badgeKeys.map((badgeKey) => ({ userId, badgeKey })))
      .orIgnore()
      .execute();
  }
}
