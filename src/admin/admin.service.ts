import { Injectable } from '@nestjs/common';

import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class AdminService {
  constructor(private prisma: DatabaseService) {}

  getGroups() {
    return this.prisma.group.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { name: true } },
        _count: { select: { transactions: true, members: true } },
      },
    });
  }

  getTransactions() {
    return this.prisma.transaction.findMany();
  }

  getActivities() {
    return this.prisma.activityLog.findMany();
  }

  getUsers() {
    return this.prisma.user.findMany();
  }

  getBugs() {
    return this.prisma.bugReport.findMany();
  }
}
