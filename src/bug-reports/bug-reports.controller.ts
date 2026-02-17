import { Controller, Get, Post, Body } from '@nestjs/common';

import { BugReportsService } from 'src/bug-reports/bug-reports.service';

import { CreateBugReportDto } from 'src/schema/bug-reports';

@Controller('bug-reports')
export class BugReportsController {
  constructor(private readonly bugReportsService: BugReportsService) {}

  @Post()
  create(@Body() dto: CreateBugReportDto) {
    return this.bugReportsService.create(dto);
  }

  @Get()
  findAll() {
    return this.bugReportsService.findAll();
  }
}
