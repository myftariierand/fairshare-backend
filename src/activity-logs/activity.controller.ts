import { Controller, Get, Query } from '@nestjs/common';

import { ActivityLogsService } from 'src/activity-logs/activity.service';
import { UserId } from 'src/users/user.decorator';

import { GetActivityQueryDto } from 'src/schema/activity-logs';

@Controller('activity-logs')
export class ActivityLogsController {
  constructor(private activityService: ActivityLogsService) {}

  @Get()
  async getActivityLogs(
    @UserId() userId,
    @Query() params: GetActivityQueryDto,
  ) {
    return this.activityService.getActivityLogs(userId, params);
  }
}
