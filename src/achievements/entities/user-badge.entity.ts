import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_badges')
@Index(['userId', 'badgeKey'], { unique: true })
export class UserBadgeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'badge_key' })
  badgeKey!: string;

  @CreateDateColumn({ name: 'earned_at' })
  earnedAt!: Date;
}
