import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { paymentsConfig } from '../../config/configuration';
import { PayoutEntity } from '../payouts/payout.entity';
import { UserProgressEntity } from '../users/user-progress.entity';
import { UserEntity } from '../users/user.entity';
import { badgeStatus, evaluateBadges } from './domain/badge';
import { evaluateAchievements } from './domain/evaluate';
import { nextAvailableAchievements } from './domain/next-available';
import type { AchievementDefinition, BadgeDefinition, Metric, UserState } from './domain/types';
import type { AchievementsResponse } from './dto/achievements-response.dto';
import { AchievementDefinitionEntity } from './entities/achievement-definition.entity';
import { BadgeDefinitionEntity } from './entities/badge-definition.entity';
import { UserAchievementEntity } from './entities/user-achievement.entity';
import { UserBadgeEntity } from './entities/user-badge.entity';

/** Outcome of applying one purchase event, for the caller to emit events from. */
export interface ApplyResult {
  /** False when the event had already been processed and was ignored. */
  applied: boolean;
  unlockedAchievementNames: string[];
  unlockedBadges: { key: string; name: string; payoutId: string }[];
}

const toAchievementDefinition = (entity: AchievementDefinitionEntity): AchievementDefinition => ({
  key: entity.key,
  name: entity.name,
  groupKey: entity.groupKey,
  metric: entity.metric as Metric,
  threshold: entity.threshold,
  tier: entity.tier,
});

const toBadgeDefinition = (entity: BadgeDefinitionEntity): BadgeDefinition => ({
  key: entity.key,
  name: entity.name,
  requiredAchievementCount: entity.requiredAchievementCount,
});

@Injectable()
export class AchievementsService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(paymentsConfig.KEY)
    private readonly payments: ConfigType<typeof paymentsConfig>,
  ) {}

  /**
   * Applies one purchase event inside a single transaction:
   * dedupe insert, counter increment, achievement inserts, badge inserts, and a
   * pending payout row per badge.
   *
   * Returns `applied: false` without side effects if the event was already
   * processed. Callers emit domain events only after this resolves.
   */
  async applyPurchaseEvent(eventId: string, userId: string): Promise<ApplyResult> {
    return this.dataSource.transaction(async (manager) => {
      // RETURNING makes the "already processed" case observable from the row
      // count without a second round trip, and the whole statement is atomic.
      const dedupeRows: { event_id: string }[] = await manager.query(
        'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id',
        [eventId],
      );
      if (dedupeRows.length === 0) {
        return { applied: false, unlockedAchievementNames: [], unlockedBadges: [] };
      }

      // Increment-and-read in one statement takes the row lock that serialises
      // concurrent purchases for this user, so no update is ever lost. Written as
      // an upsert so a user without a progress row counts their first purchase
      // rather than crashing on an absent row.
      const progressRows: { purchase_count: number }[] = await manager.query(
        `INSERT INTO user_progress (user_id, purchase_count) VALUES ($1, 1)
         ON CONFLICT (user_id) DO UPDATE SET purchase_count = user_progress.purchase_count + 1
         RETURNING purchase_count`,
        [userId],
      );
      const purchaseCount = progressRows[0].purchase_count;

      const achievementDefinitions = (await manager.find(AchievementDefinitionEntity)).map(
        toAchievementDefinition,
      );
      const badgeDefinitions = (await manager.find(BadgeDefinitionEntity)).map(toBadgeDefinition);
      const unlockedAchievementKeys = (
        await manager.find(UserAchievementEntity, { where: { userId } })
      ).map((row) => row.achievementKey);
      const earnedBadgeKeys = (await manager.find(UserBadgeEntity, { where: { userId } })).map(
        (row) => row.badgeKey,
      );

      const state: UserState = {
        progress: { purchaseCount },
        unlockedAchievementKeys,
        earnedBadgeKeys,
      };

      const newAchievements = evaluateAchievements(state, achievementDefinitions);
      if (newAchievements.length > 0) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(UserAchievementEntity)
          .values(newAchievements.map((d) => ({ userId, achievementKey: d.key })))
          .orIgnore()
          .execute();
      }

      // The badge ladder is measured against the unlocked count, including what
      // was just inserted above, so a purchase that crosses both an achievement
      // tier and a badge threshold in the same event unlocks both.
      const stateAfterAchievements: UserState = {
        ...state,
        unlockedAchievementKeys: [...unlockedAchievementKeys, ...newAchievements.map((d) => d.key)],
      };
      const newBadges = evaluateBadges(stateAfterAchievements, badgeDefinitions);
      if (newBadges.length > 0) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(UserBadgeEntity)
          .values(newBadges.map((d) => ({ userId, badgeKey: d.key })))
          .orIgnore()
          .execute();
      }

      const unlockedBadges = await this.writePayouts(manager, userId, newBadges);

      return {
        applied: true,
        unlockedAchievementNames: newAchievements.map((d) => d.name),
        unlockedBadges,
      };
    });
  }

  /**
   * Writes one pending payout per newly earned badge, in the same transaction as
   * the badge itself. The provider reference is deterministic — `userId:badgeKey`
   * — so a retry of this same event can never mint a second reference for it.
   */
  private async writePayouts(
    manager: EntityManager,
    userId: string,
    newBadges: BadgeDefinition[],
  ): Promise<{ key: string; name: string; payoutId: string }[]> {
    const unlockedBadges: { key: string; name: string; payoutId: string }[] = [];

    for (const badge of newBadges) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(PayoutEntity)
        .values({
          userId,
          badgeKey: badge.key,
          amountKobo: this.payments.cashbackAmountKobo,
          status: 'pending',
          providerReference: `${userId}:${badge.key}`,
          attempts: 0,
        })
        .orIgnore()
        .execute();

      const payout = await manager.findOneOrFail(PayoutEntity, {
        where: { userId, badgeKey: badge.key },
      });
      unlockedBadges.push({ key: badge.key, name: badge.name, payoutId: payout.id });
    }

    return unlockedBadges;
  }

  /** Assembles the achievements view for a user. Throws NotFound for an unknown user. */
  async getAchievementsView(userId: string): Promise<AchievementsResponse> {
    const user = await this.dataSource.getRepository(UserEntity).findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException();
    }

    const progress = await this.dataSource
      .getRepository(UserProgressEntity)
      .findOne({ where: { userId } });
    const unlockedAchievementKeys = (
      await this.dataSource.getRepository(UserAchievementEntity).find({ where: { userId } })
    ).map((row) => row.achievementKey);
    const earnedBadgeKeys = (
      await this.dataSource.getRepository(UserBadgeEntity).find({ where: { userId } })
    ).map((row) => row.badgeKey);
    const achievementDefinitions = (
      await this.dataSource.getRepository(AchievementDefinitionEntity).find()
    ).map(toAchievementDefinition);
    const badgeDefinitions = (
      await this.dataSource.getRepository(BadgeDefinitionEntity).find()
    ).map(toBadgeDefinition);

    const state: UserState = {
      // A user without a progress row (never purchased) reads as zero, not missing.
      progress: { purchaseCount: progress?.purchaseCount ?? 0 },
      unlockedAchievementKeys,
      earnedBadgeKeys,
    };

    const definitionByKey = new Map(achievementDefinitions.map((d) => [d.key, d]));
    const unlockedAchievements = state.unlockedAchievementKeys
      .map((key) => definitionByKey.get(key))
      .filter((definition): definition is AchievementDefinition => definition !== undefined)
      .sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.tier - b.tier)
      .map((definition) => definition.name);

    const nextAvailable = nextAvailableAchievements(state, achievementDefinitions).map(
      (definition) => definition.name,
    );
    const badge = badgeStatus(state, badgeDefinitions);

    return {
      unlocked_achievements: unlockedAchievements,
      next_available_achievements: nextAvailable,
      current_badge: badge.currentBadge,
      next_badge: badge.nextBadge,
      remaining_to_unlock_next_badge: badge.remainingToUnlockNextBadge,
    };
  }
}
