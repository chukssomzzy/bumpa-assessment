import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { UserEntity } from './user.entity';

/**
 * Derived state, maintained from the purchase event stream. The service does not
 * own an orders table, so this counter is the source of truth for progress and
 * its correctness is a first-class concern.
 */
@Entity('user_progress')
export class UserProgressEntity {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'purchase_count', type: 'int', default: 0 })
  purchaseCount!: number;

  @OneToOne(() => UserEntity, (u) => u.progress, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;
}
