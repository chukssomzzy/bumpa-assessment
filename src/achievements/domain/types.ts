/**
 * Pure domain types. No framework, no ORM, no I/O.
 *
 * Everything in this folder operates on plain data so the rules can be read and
 * tested without booting anything. Persistence maps onto these shapes at the edge.
 */

/** A metric the achievement ladder can be measured against. */
export type Metric = 'purchase_count';

/** A definition of an achievement, as seeded reference data. */
export interface AchievementDefinition {
  key: string;
  name: string;
  /** Achievements are laddered within a group; only the next tier per group is offered. */
  groupKey: string;
  metric: Metric;
  /** Value of `metric` at which this achievement unlocks. */
  threshold: number;
  /** Position within the group, ascending. Unique per group. */
  tier: number;
}

/** A definition of a badge, as seeded reference data. */
export interface BadgeDefinition {
  key: string;
  name: string;
  /** Total achievements required. A value of 0 marks the initial badge. */
  requiredAchievementCount: number;
}

/** A user's measurable progress. */
export interface UserProgress {
  purchaseCount: number;
}

/** Everything the rules need to know about a user's current state. */
export interface UserState {
  progress: UserProgress;
  /** Keys of achievements already unlocked. */
  unlockedAchievementKeys: readonly string[];
  /** Keys of badges already earned. */
  earnedBadgeKeys: readonly string[];
}

/** The badge portion of the achievements endpoint response. */
export interface BadgeStatus {
  currentBadge: string;
  nextBadge: string | null;
  remainingToUnlockNextBadge: number;
}
