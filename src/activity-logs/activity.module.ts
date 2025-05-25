import { Global, Module } from '@nestjs/common';

import { ActivityLogsController } from 'src/activity-logs/activity.controller';
import { ActivityLogsService } from 'src/activity-logs/activity.service';

@Global()
@Module({
  controllers: [ActivityLogsController],
  providers: [ActivityLogsService],
  exports: [ActivityLogsService],
})
export class ActivityLogsModule {}
