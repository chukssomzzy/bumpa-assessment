import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_achievements')
@Index(['userId', 'achievementKey'], { unique: true })
export class UserAchievementEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'achievement_key' })
  achievementKey!: string;

  @CreateDateColumn({ name: 'unlocked_at' })
  unlockedAt!: Date;
}
