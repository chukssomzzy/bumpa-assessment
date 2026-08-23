import type { DataSource } from 'typeorm';
import { AchievementDefinitionEntity } from '../achievements/entities/achievement-definition.entity';
import { BadgeDefinitionEntity } from '../achievements/entities/badge-definition.entity';
import { UserBadgeEntity } from '../achievements/entities/user-badge.entity';
import { UserProgressEntity } from '../users/user-progress.entity';
import { UserEntity } from '../users/user.entity';
import { ACHIEVEMENT_DEFINITIONS, BADGE_DEFINITIONS, DEMO_USERS } from './seeds/definitions';

/**
 * Idempotent. Safe to re-run on every boot of the migrate step, and between test
 * suites, without duplicating rows.
 */
export async function seed(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (manager) => {
    await manager
      .createQueryBuilder()
      .insert()
      .into(AchievementDefinitionEntity)
      .values(ACHIEVEMENT_DEFINITIONS)
      .orUpdate(['name', 'group_key', 'metric', 'threshold', 'tier'], ['key'])
      .execute();

    await manager
      .createQueryBuilder()
      .insert()
      .into(BadgeDefinitionEntity)
      .values(BADGE_DEFINITIONS)
      .orUpdate(['name', 'required_achievement_count'], ['key'])
      .execute();

    const initialBadge = BADGE_DEFINITIONS.reduce((lowest, badge) =>
      badge.requiredAchievementCount < lowest.requiredAchievementCount ? badge : lowest,
    );

    for (const user of DEMO_USERS) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(UserEntity)
        .values(user)
        .orUpdate(['name', 'bank_code', 'account_number'], ['id'])
        .execute();

      await manager
        .createQueryBuilder()
        .insert()
        .into(UserProgressEntity)
        .values({ userId: user.id, purchaseCount: 0 })
        .orIgnore()
        .execute();

      // Initial state: granted without an event and without a payout.
      await manager
        .createQueryBuilder()
        .insert()
        .into(UserBadgeEntity)
        .values({ userId: user.id, badgeKey: initialBadge.key })
        .orIgnore()
        .execute();
    }
  });
}
