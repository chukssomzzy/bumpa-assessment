import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { UserAchievementEntity } from '../entities/user-achievement.entity';

@Injectable()
export class UserAchievementRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async listUnlockedKeys(userId: string): Promise<string[]> {
    const rows = await this.txHost.tx.find(UserAchievementEntity, { where: { userId } });
    return rows.map((row) => row.achievementKey);
  }

  /**
   * Inserts newly crossed achievement tiers. `orIgnore` makes this safe to call
   * with a tier the user already holds, which should never happen given the
   * evaluation logic but costs nothing to guard against at the write.
   */
  async insertNewAchievements(userId: string, achievementKeys: string[]): Promise<void> {
    if (achievementKeys.length === 0) return;
    await this.txHost.tx
      .createQueryBuilder()
      .insert()
      .into(UserAchievementEntity)
      .values(achievementKeys.map((achievementKey) => ({ userId, achievementKey })))
      .orIgnore()
      .execute();
  }
}
