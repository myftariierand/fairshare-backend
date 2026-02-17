import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

import { DatabaseService } from 'src/database/database.service';

import { CreateBugReportDto } from 'src/schema/bug-reports';

@Injectable()
export class BugReportsService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly mailerService: MailerService,
  ) {}

  async create(data: CreateBugReportDto) {
    const bug = await this.prisma.bugReport.create({
      data,
    });

    await this.mailerService.sendMail({
      to: 'admin@yourapp.com',
      subject: `New Bug Report - ${bug.severity}`,
      template: 'bug-report-notification',
      context: {
        title: bug.title,
        description: bug.description,
        severity: bug.severity,
        name: bug.name,
        email: bug.email,
        device: bug.device,
        createdAt: bug.createdAt.toISOString(),
      },
    });

    return bug;
  }

  async findAll() {
    return this.prisma.bugReport.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}
