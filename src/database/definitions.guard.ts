import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Refuses to start when reference data is missing.
 *
 * An unseeded database does not error at runtime — it silently unlocks nothing
 * and pays nobody, which is far worse than failing to boot. This turns that into
 * a loud crash, and also guarantees the rules layer never sees an empty ladder.
 */
@Injectable()
export class DefinitionsGuard implements OnApplicationBootstrap {
  private readonly logger = new Logger(DefinitionsGuard.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const [achievements, badges] = await Promise.all([
      this.count('achievements'),
      this.count('badges'),
    ]);

    if (achievements === 0 || badges === 0) {
      throw new Error(
        `Reference data missing (achievements: ${achievements}, badges: ${badges}). ` +
          'Run `npm run db:setup` before starting the service.',
      );
    }

    // A badge ladder that outruns the achievement ladder makes every cashback
    // above the initial badge permanently unreachable, without failing anything.
    const highestRequirement = await this.highestBadgeRequirement();
    if (highestRequirement > achievements) {
      this.logger.warn(
        `Top badge requires ${highestRequirement} achievements but only ${achievements} exist; ` +
          'the highest badges are unreachable.',
      );
    }
  }

  private async count(table: string): Promise<number> {
    const rows = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM "${table}"`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async highestBadgeRequirement(): Promise<number> {
    const rows = await this.dataSource.query<{ max: string | null }[]>(
      `SELECT MAX(required_achievement_count)::text AS max FROM "badges"`,
    );
    return Number(rows[0]?.max ?? 0);
  }
}
