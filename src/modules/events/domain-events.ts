import type { UserEntity } from '../users/user.entity';

export const ACHIEVEMENT_UNLOCKED = 'achievement.unlocked';
export const BADGE_UNLOCKED = 'badge.unlocked';

/** Payload required by the brief. */
export class AchievementUnlockedEvent {
  constructor(
    readonly achievement_name: string,
    readonly user: UserEntity,
  ) {}
}

/** Payload required by the brief. Triggers the cashback. */
export class BadgeUnlockedEvent {
  constructor(
    readonly badge_name: string,
    readonly user: UserEntity,
    /** The pending payout written in the same transaction as the badge. */
    readonly payoutId: string,
  ) {}
}
