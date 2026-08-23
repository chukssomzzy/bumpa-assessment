import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Seeded reference data. A zero requirement marks the initial badge. */
@Entity('badges')
export class BadgeDefinitionEntity {
  @PrimaryColumn()
  key!: string;

  @Column()
  name!: string;

  @Column({ name: 'required_achievement_count', type: 'int', unique: true })
  requiredAchievementCount!: number;
}
