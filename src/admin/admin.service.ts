import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { BugStatus, Severity } from '@prisma/client';

import { ActivityLogsService } from 'src/activity-logs/activity.service';
import { DatabaseService } from 'src/database/database.service';
import { AccountDeletionService } from 'src/users/account-deletion.service';
import { AdminActivitiesQuery } from 'src/schema/admin';

@Injectable()
export class AdminService {
  constructor(
    private prisma: DatabaseService,
    private activityLogsService: ActivityLogsService,
    private accountDeletionService: AccountDeletionService,
  ) {}

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
          include: { paidBy: true },
        },
        _count: { select: { transactions: true, members: true } },
      },
    });
  }

  async getActivities({ page, limit }: AdminActivitiesQuery) {
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.activityLog.findMany({
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          user: true,
          targetUser: true,
        },
      }),

      this.prisma.activityLog.count(),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPreviousPage: page > 1,
      },
    };
  }

  getUsers() {
    return this.prisma.user.findMany({
      where: { role: 'USER', deletedAt: null },
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
    });
  }

  getBugs() {
    return this.prisma.bugReport.findMany({ orderBy: [{ createdAt: 'desc' }] });
  }

  updateBugReport(id: string, status?: BugStatus, severity?: Severity) {
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

  async updateUser(adminId: string, id: string, newPassword: string) {
    const target = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { role: true },
    });

    if (!target) throw new NotFoundException('User not found');

    // It would let one admin take over another's account
    if (target.role === 'ADMIN') {
      throw new ForbiddenException('Admin passwords cannot be reset here.');
    }

    const password = await bcrypt.hash(newPassword, 10);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { password },
      });

      await tx.refreshToken.deleteMany({ where: { userId: id } });

      await this.activityLogsService.createActivityLog(
        {
          action: 'ADMIN_RESET_PASSWORD',
          user: { connect: { id: adminId } },
          targetUser: { connect: { id } },
        },
        tx,
      );

      return user;
    });
  }

  async deleteUser(adminId: string, id: string) {
    await this.accountDeletionService.deleteAccount(id, adminId);

    return { message: 'User deleted' };
  }
}
