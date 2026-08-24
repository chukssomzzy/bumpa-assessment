import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponse } from '../../common/dto/error-response.dto';
import { AchievementsService } from './achievements.service';
import { AchievementsResponse } from './dto/achievements-response.dto';

@ApiTags('achievements')
@Controller('users')
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @ApiOperation({
    summary: 'Read a customer’s achievement and badge progress',
    description:
      'Returns unlocked achievements, the next achievement per group, the current badge and the distance to the next one. ' +
      'The payload is returned raw — success responses are deliberately not wrapped in an envelope.',
  })
  @ApiParam({ name: 'user', description: 'Customer id', format: 'uuid' })
  @ApiOkResponse({ description: 'Current progress for the customer.', type: AchievementsResponse })
  @ApiBadRequestResponse({ description: 'The id is not a valid uuid.', type: ErrorResponse })
  @ApiNotFoundResponse({ description: 'No such customer.', type: ErrorResponse })
  @Get(':user/achievements')
  get(@Param('user', ParseUUIDPipe) user: string): Promise<AchievementsResponse> {
    return this.achievements.getAchievementsView(user);
  }
}
