import { Module } from '@nestjs/common';

import { BugReportsController } from 'src/bug-reports/bug-reports.controller';
import { BugReportsService } from 'src/bug-reports/bug-reports.service';

import { EmailModule } from 'src/email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [BugReportsController],
  providers: [BugReportsService],
})
export class BugReportsModule {}
