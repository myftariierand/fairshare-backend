import { Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from 'src/database/database.service';
import { EmailService } from 'src/email/email.service';
import { sendInBackground } from 'src/email/send-in-background';

import { CreateBugReportDto } from 'src/schema/bug-reports';

@Injectable()
export class BugReportsService {
  private readonly logger = new Logger(BugReportsService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly emailService: EmailService,
  ) {}

  async create(data: CreateBugReportDto) {
    const bug = await this.prisma.bugReport.create({
      data,
    });

    const to = process.env.NOTIFICATION_EMAIL;

    if (to) {
      sendInBackground(
        this.emailService,
        this.logger,
        to,
        'bug-report-notification',
        {
          title: bug.title,
          description: bug.description,
          severity: bug.severity,
          name: bug.name,
          email: bug.email,
          device: bug.device,
          createdAt: bug.createdAt,
        },
      );
    }

    return bug;
  }
}
