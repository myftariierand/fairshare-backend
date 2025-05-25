import { Controller, Get } from '@nestjs/common';

import { ActivityLogsService } from 'src/activity-logs/activity.service';

@Controller('activity-logs')
export class ActivityLogsController {
  constructor(private activityService: ActivityLogsService) {}

  @Get()
  async getActivityLogs() {
    return this.activityService.getActivityLogs();
  }
}
