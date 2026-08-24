import { ApiProperty } from '@nestjs/swagger';

/**
 * The response contract for `GET /users/:user/achievements`.
 *
 * A class rather than an interface purely so it can carry OpenAPI metadata —
 * an interface has no runtime representation to decorate. Nothing constructs
 * it; the service returns a plain object, which satisfies it structurally.
 *
 * The snake_case keys are the API contract and must not be renamed, and this
 * payload is deliberately NOT wrapped in a success envelope.
 */
export class AchievementsResponse {
  @ApiProperty({
    description: 'Names of every achievement the customer has unlocked.',
    example: ['First Purchase', '3 Purchases', '5 Purchases', '10 Purchases'],
    type: [String],
  })
  unlocked_achievements!: string[];

  @ApiProperty({
    description: 'Only the next unlockable achievement per group, never the full remaining ladder.',
    example: ['15 Purchases'],
    type: [String],
  })
  next_available_achievements!: string[];

  @ApiProperty({
    description: 'Never null: the zero-requirement entry badge is granted at user creation.',
    example: 'Intermediate',
  })
  current_badge!: string;

  @ApiProperty({
    description: 'The next badge up the ladder, or null once the top badge is held.',
    example: 'Advanced',
    nullable: true,
    type: String,
  })
  next_badge!: string | null;

  @ApiProperty({
    description:
      'How many further achievements are needed for `next_badge`. Zero once the top badge is held.',
    example: 4,
  })
  remaining_to_unlock_next_badge!: number;
}
