import { Controller, Post, Body } from '@nestjs/common';

import { BugReportsService } from 'src/bug-reports/bug-reports.service';

import { CreateBugReportDto } from 'src/schema/bug-reports';

import { ThrottleByClient } from 'src/throttling';

@Controller('bug-reports')
export class BugReportsController {
  constructor(private readonly bugReportsService: BugReportsService) {}

  @ThrottleByClient(5)
  @Post()
  create(@Body() dto: CreateBugReportDto) {
    return this.bugReportsService.create(dto);
  }
}
