import { Injectable } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { DatabaseService } from 'src/database/database.service';

import type { GetActivityQuery } from 'src/schema/activity-logs';

@Injectable()
export class ActivityLogsService {
  constructor(private prisma: DatabaseService) {}

  async getActivityLogs(userId: string, { page = 1 }: GetActivityQuery) {
    const pageSize = 15;

    const where: Prisma.ActivityLogWhereInput = {
      OR: [
        { userId },
        { targetUserId: userId },
        { group: { members: { some: { userId } } } },
        { transaction: { group: { members: { some: { userId } } } } },
        // {
        //   snapshot: {
        //     path: ['group', 'members'],
        //     array_contains: [{ userId }],
        //   },
        // },
      ],
    };

    const [total, logs] = await this.prisma.$transaction([
      this.prisma.activityLog.count({
        where,
      }),
      this.prisma.activityLog.findMany({
        // where,
        // take: pageSize,
        // skip: (page - 1) * pageSize,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          user: true,
          group: true,
          transaction: true,
          targetUser: true,
        },
      }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    return {
      pagination: { page, totalPages },
      data: logs,
    };
  }

  async createActivityLog(data: Prisma.ActivityLogCreateInput) {
    return this.prisma.activityLog.create({
      data,
    });
  }
}
