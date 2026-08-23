import type { DataSource } from 'typeorm';
import { AchievementDefinitionEntity } from '../modules/achievements/entities/achievement-definition.entity';
import { BadgeDefinitionEntity } from '../modules/achievements/entities/badge-definition.entity';
import { UserBadgeEntity } from '../modules/achievements/entities/user-badge.entity';
import { UserProgressEntity } from '../modules/users/user-progress.entity';
import { UserEntity } from '../modules/users/user.entity';
import { ACHIEVEMENT_DEFINITIONS, BADGE_DEFINITIONS, DEMO_USERS } from './seeds/definitions';

/**
 * Reference data. Seeded once per database; never truncated, since the system
 * reads it at runtime and an empty table would silently unlock nothing.
 */
export async function seedDefinitions(dataSource: DataSource): Promise<void> {
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
  });
}

/**
 * Demo customers, so the documented flow is executable on a clean checkout.
 * Separate from definitions because tests truncate users between cases but keep
 * the reference data.
 */
export async function seedDemoUsers(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (manager) => {
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

/** The full seed, as run by the migrate entrypoint. */
export async function seed(dataSource: DataSource): Promise<void> {
  await seedDefinitions(dataSource);
  await seedDemoUsers(dataSource);
}
