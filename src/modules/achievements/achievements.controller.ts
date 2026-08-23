import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { AchievementsService } from './achievements.service';
import type { AchievementsResponse } from './dto/achievements-response.dto';

@Controller('users')
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get(':user/achievements')
  get(@Param('user', ParseUUIDPipe) user: string): Promise<AchievementsResponse> {
    return this.achievements.getAchievementsView(user);
  }
}
