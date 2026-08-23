import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AchievementsResponse } from './dto/achievements-response.dto';

/** Outcome of applying one purchase event, for the caller to emit events from. */
export interface ApplyResult {
  /** False when the event had already been processed and was ignored. */
  applied: boolean;
  unlockedAchievementNames: string[];
  unlockedBadges: { key: string; name: string; payoutId: string }[];
}

@Injectable()
export class AchievementsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Applies one purchase event inside a single transaction:
   * dedupe insert, counter increment, achievement inserts, badge inserts, and a
   * pending payout row per badge.
   *
   * Returns `applied: false` without side effects if the event was already
   * processed. Callers emit domain events only after this resolves.
   */
  applyPurchaseEvent(_eventId: string, _userId: string): Promise<ApplyResult> {
    throw new Error('not implemented');
  }

  /** Assembles the achievements view for a user. Throws NotFound for an unknown user. */
  getAchievementsView(_userId: string): Promise<AchievementsResponse> {
    throw new Error('not implemented');
  }
}
