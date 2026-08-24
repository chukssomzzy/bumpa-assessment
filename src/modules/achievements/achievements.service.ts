import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Transactional } from '@nestjs-cls/transactional';
import { paymentsConfig } from '../../config/configuration';
import { ProcessedEventRepository } from '../events/repositories/processed-event.repository';
import { PayoutRepository } from '../payouts/repositories/payout.repository';
import { UserRepository } from '../users/repositories/user.repository';
import { badgeStatus, evaluateBadges } from './domain/badge';
import { evaluateAchievements } from './domain/evaluate';
import { nextAvailableAchievements } from './domain/next-available';
import type { AchievementDefinition, BadgeDefinition, Metric, UserState } from './domain/types';
import type { AchievementsResponse } from './dto/achievements-response.dto';
import { AchievementDefinitionEntity } from './entities/achievement-definition.entity';
import { BadgeDefinitionEntity } from './entities/badge-definition.entity';
import { AchievementDefinitionRepository } from './repositories/achievement-definition.repository';
import { BadgeDefinitionRepository } from './repositories/badge-definition.repository';
import { UserAchievementRepository } from './repositories/user-achievement.repository';
import { UserBadgeRepository } from './repositories/user-badge.repository';
import { UserProgressRepository } from './repositories/user-progress.repository';

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
    private readonly processedEvents: ProcessedEventRepository,
    private readonly userProgress: UserProgressRepository,
    private readonly achievementDefinitions: AchievementDefinitionRepository,
    private readonly badgeDefinitions: BadgeDefinitionRepository,
    private readonly userAchievements: UserAchievementRepository,
    private readonly userBadges: UserBadgeRepository,
    private readonly payouts: PayoutRepository,
    private readonly users: UserRepository,
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
  @Transactional()
  async applyPurchaseEvent(eventId: string, userId: string): Promise<ApplyResult> {
    const isNewEvent = await this.processedEvents.recordEventIfNew(eventId);
    if (!isNewEvent) {
      return { applied: false, unlockedAchievementNames: [], unlockedBadges: [] };
    }

    const purchaseCount = await this.userProgress.incrementPurchaseCount(userId);

    const achievementDefinitions = (await this.achievementDefinitions.listAll()).map(
      toAchievementDefinition,
    );
    const badgeDefinitions = (await this.badgeDefinitions.listAll()).map(toBadgeDefinition);
    const unlockedAchievementKeys = await this.userAchievements.listUnlockedKeys(userId);
    const earnedBadgeKeys = await this.userBadges.listEarnedKeys(userId);

    const state: UserState = {
      progress: { purchaseCount },
      unlockedAchievementKeys,
      earnedBadgeKeys,
    };

    const newAchievements = evaluateAchievements(state, achievementDefinitions);
    await this.userAchievements.insertNewAchievements(
      userId,
      newAchievements.map((d) => d.key),
    );

    // The badge ladder is measured against the unlocked count, including what
    // was just inserted above, so a purchase that crosses both an achievement
    // tier and a badge threshold in the same event unlocks both.
    const stateAfterAchievements: UserState = {
      ...state,
      unlockedAchievementKeys: [...unlockedAchievementKeys, ...newAchievements.map((d) => d.key)],
    };
    const newBadges = evaluateBadges(stateAfterAchievements, badgeDefinitions);
    await this.userBadges.insertNewBadges(
      userId,
      newBadges.map((d) => d.key),
    );

    const unlockedBadges = await this.writePayouts(userId, newBadges);

    return {
      applied: true,
      unlockedAchievementNames: newAchievements.map((d) => d.name),
      unlockedBadges,
    };
  }

  /**
   * Writes one pending payout per newly earned badge, in the same transaction as
   * the badge itself. The provider reference is deterministic — `userId:badgeKey`
   * — so a retry of this same event can never mint a second reference for it.
   */
  private async writePayouts(
    userId: string,
    newBadges: BadgeDefinition[],
  ): Promise<{ key: string; name: string; payoutId: string }[]> {
    const unlockedBadges: { key: string; name: string; payoutId: string }[] = [];

    for (const badge of newBadges) {
      const payout = await this.payouts.insertPendingPayoutIfAbsent({
        userId,
        badgeKey: badge.key,
        // `?? 30_000` mirrors the zod schema's own default in configuration.ts:
        // `ConfigType`'s conditional type resolves this field as possibly
        // `undefined` at this access site even though the schema guarantees a
        // value, the same quirk `payouts.service.ts` works around for its own
        // config fields.
        amountKobo: this.payments.cashbackAmountKobo ?? 30_000,
        // `_`, not `:`. Paystack rejects a reference containing a colon with
        // "Your reference contains illegal special characters" (HTTP 400) on
        // both /transfer and /transfer/verify — which strands the payout
        // permanently, since an unknown reconciliation outcome is never
        // terminal. Verified against the live API: `-` and `_` are accepted,
        // `:` and `.` are not. Underscore keeps the separator unambiguous,
        // because a UUID contains hyphens but never underscores.
        providerReference: `${userId}_${badge.key}`,
      });
      unlockedBadges.push({ key: badge.key, name: badge.name, payoutId: payout.id });
    }

    return unlockedBadges;
  }

  /** Assembles the achievements view for a user. Throws NotFound for an unknown user. */
  async getAchievementsView(userId: string): Promise<AchievementsResponse> {
    if (!(await this.users.exists(userId))) {
      throw new NotFoundException();
    }

    const purchaseCount = await this.userProgress.findPurchaseCount(userId);
    const unlockedAchievementKeys = await this.userAchievements.listUnlockedKeys(userId);
    const earnedBadgeKeys = await this.userBadges.listEarnedKeys(userId);
    const achievementDefinitions = (await this.achievementDefinitions.listAll()).map(
      toAchievementDefinition,
    );
    const badgeDefinitions = (await this.badgeDefinitions.listAll()).map(toBadgeDefinition);

    const state: UserState = {
      progress: { purchaseCount },
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
