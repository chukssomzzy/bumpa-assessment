/** The response contract for `GET /users/:user/achievements`. */
export interface AchievementsResponse {
  unlocked_achievements: string[];
  /** Only the next unlockable achievement per group, never the full ladder. */
  next_available_achievements: string[];
  /** Never null: the zero-requirement badge is granted at user creation. */
  current_badge: string;
  next_badge: string | null;
  remaining_to_unlock_next_badge: number;
}
