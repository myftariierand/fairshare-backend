import { Injectable } from '@nestjs/common';

import { DatabaseService } from 'src/database/database.service';
import { EmailService } from 'src/email/email.service';

import { CreateBugReportDto } from 'src/schema/bug-reports';

import { renderTemplate } from 'templates/render-template';

@Injectable()
export class BugReportsService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly emailService: EmailService,
  ) {}

  async create(data: CreateBugReportDto) {
    const bug = await this.prisma.bugReport.create({
      data,
    });

    const html = renderTemplate('bug-report-notification', {
      title: bug.title,
      description: bug.description,
      severity: bug.severity,
      name: bug.name,
      email: bug.email,
      device: bug.device,
      createdAt: bug.createdAt.toISOString(),
    });

    this.emailService.sendEmail({
      to: 'myftarierand@gmail.com',
      subject: `New Bug Report - ${bug.severity}`,
      html,
    });

    return bug;
  }

  async findAll() {
    return this.prisma.bugReport.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}
