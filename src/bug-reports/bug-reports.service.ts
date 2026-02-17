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
    try {
      const bug = await this.prisma.bugReport.create({
        data,
      });

      console.log('Attempting to send email...');
      console.log('NODE_ENV:', process.env.NODE_ENV);
      console.log('GMAIL_USER:', process.env.GMAIL_USER);
      console.log('GMAIL_PASS SET:', !!process.env.GMAIL_APP_PASSWORD);

      await this.mailerService.sendMail({
        to: 'myftarierand@gmail.com',
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

      console.log('Email sent successfully!');

      return bug;
    } catch (error) {
      console.error('Email error:', error);
      throw error;
    }
  }

  async findAll() {
    return this.prisma.bugReport.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}
