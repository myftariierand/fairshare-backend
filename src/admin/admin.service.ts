import { Injectable } from '@nestjs/common';

import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class AdminService {
  constructor(private prisma: DatabaseService) {}

  getGroups() {
    return this.prisma.group.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: {
        createdBy: { select: { name: true } },
        members: {
          select: { user: { select: { id: true, name: true, email: true } } },
        },
        transactions: {
          where: { type: 'EXPENSE' },
          orderBy: { createdAt: 'desc' },
          include: { paidBy: { omit: { password: true } } },
        },
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
