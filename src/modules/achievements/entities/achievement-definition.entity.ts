import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Seeded reference data the system reads at runtime. */
@Entity('achievements')
@Index(['groupKey', 'tier'], { unique: true })
export class AchievementDefinitionEntity {
  @PrimaryColumn()
  key!: string;

  @Column()
  name!: string;

  @Column({ name: 'group_key' })
  groupKey!: string;

  @Column()
  metric!: string;

  @Column({ type: 'int' })
  threshold!: number;

  @Column({ type: 'int' })
  tier!: number;
}
