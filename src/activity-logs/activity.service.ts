import { Injectable } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class ActivityLogsService {
  constructor(private prisma: DatabaseService) {}

  async getActivityLogs() {
    return this.prisma.activityLog.findMany();
  }

  async createActivityLog(data: Prisma.ActivityLogCreateInput) {
    return this.prisma.activityLog.create({
      data,
    });
  }
}
