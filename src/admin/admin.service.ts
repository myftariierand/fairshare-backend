import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { BugStatus, Severity } from '@prisma/client';

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

  getActivities() {
    return this.prisma.activityLog.findMany();
  }

  getUsers() {
    return this.prisma.user.findMany({
      where: { role: 'USER' },
      orderBy: { createdAt: 'desc' },
      include: {
        memberships: {
          orderBy: { joinedAt: 'desc' },
          include: { group: true },
        },
        _count: {
          select: {
            memberships: true,
            transactionSplits: true,
            friendshipsReceiver: { where: { status: 'ACCEPTED' } },
            friendshipsSender: { where: { status: 'ACCEPTED' } },
          },
        },
      },
      omit: { password: true },
    });
  }

  getBugs() {
    return this.prisma.bugReport.findMany({ orderBy: [{ createdAt: 'desc' }] });
  }

  updateBugReport(id: string, status: BugStatus, severity: Severity) {
    return this.prisma.bugReport.update({
      where: { id },
      data: { status, severity },
    });
  }

  deleteBugReport(id: string) {
    return this.prisma.bugReport.delete({
      where: { id },
    });
  }

  async updateUser(id: string, newPassword: string) {
    const password = await bcrypt.hash(newPassword, 10);

    return this.prisma.user.update({ where: { id }, data: { password } });
  }

  deleteUser(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }
}
