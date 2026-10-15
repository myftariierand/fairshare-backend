import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { SseService } from 'src/sse/sse.service';
import { DatabaseService } from 'src/database/database.service';
import { ActivityLogsService } from 'src/activity-logs/activity.service';
import { GroupDebtService } from 'src/group-debt/groupDebt.service';
import { PushService } from 'src/devices/push.service';

import { SseEventType } from 'src/types/sse';

import { toMinorUnit } from 'src/helpers/conversion-helpers';
import { TransactionCategory } from '@prisma/client';

@Injectable()
export class TransactionsService {
  constructor(
    private sse: SseService,
    private prisma: DatabaseService,
    private activityLogsService: ActivityLogsService,
    private groupDebtService: GroupDebtService,
    private push: PushService,
  ) {}

  async findTransactions(userId: string, groupId: string) {
    const response = await this.prisma.transaction.findMany({
      where: { groupId, group: { members: { some: { userId } } } },
      orderBy: { createdAt: 'desc' },
      include: { splits: true, paidBy: true },
    });

    return response.map(
      ({
        id,
        description,
        createdAt,
        amount,
        paidBy,
        splits,
        paidById,
        type,
        category,
      }) => {
        const userSplit = splits.find((split) => split.userId === userId);

        const balance =
          paidById === userId
            ? splits.reduce(
                (sum, split) =>
                  sum + (split.userId !== userId ? split.amount.toNumber() : 0),
                0,
              )
            : -(userSplit?.amount.toNumber() ?? 0);

        return {
          id,
          description,
          paidBy: paidBy.id === userId ? 'You' : paidBy.name,
          createdAt,
          balance,
          amount,
          type,
          category,
        };
      },
    );
  }

  async findTransactionById(userId: string, id: string) {
    try {
      const transaction = await this.prisma.transaction.findUnique({
        where: {
          id,
          group: { members: { some: { userId } } },
        },
        include: {
          paidBy: true,
          createdBy: true,
          splits: {
            include: { user: true },
          },
        },
      });

      if (!transaction) throw new NotFoundException();

      return transaction;
    } catch (error) {
      throw new InternalServerErrorException('Something Went Wrong', {
        cause: error,
      });
    }
  }

  async createTransaction(
    userId: string,
    groupId: string,
    amount: number,
    category: TransactionCategory,
    description: string,
    paidBy: string,
    splits: { userId: string; amount: number }[],
  ) {
    const foundGroup = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: { members: { include: { user: true } } },
    });
    if (!foundGroup) throw new NotFoundException('Group not found');

    const groupMembersIds = foundGroup.members.map((member) => member.userId);
    if (!groupMembersIds.includes(userId))
      throw new ForbiddenException('You are not a member of this group');

    const userIds = splits.map((split) => split.userId);
    const allUsersAreMembers = userIds.every((userId) =>
      groupMembersIds.includes(userId),
    );
    if (!allUsersAreMembers)
      throw new ForbiddenException('All users should be members of the group');

    const unitAmount = toMinorUnit(amount, foundGroup.currency);
    const splitsTotal = splits.reduce(
      (acc, curr) => acc + toMinorUnit(curr.amount, foundGroup.currency),
      0,
    );

    if (splitsTotal !== unitAmount)
      throw new ForbiddenException(
        'The sum of the splits must be equal to total amount',
      );

    const transaction = await this.prisma.transaction.create({
      data: {
        amount,
        category,
        description,
        createdBy: {
          connect: {
            id: userId,
          },
        },
        paidBy: {
          connect: {
            id: paidBy,
          },
        },
        group: {
          connect: {
            id: groupId,
          },
        },
        splits: {
          createMany: { data: splits },
        },
      },
    });

    await this.activityLogsService.createActivityLog({
      action: 'TRANSACTION_CREATED',
      snapshot: { group: foundGroup, transaction },
      user: { connect: { id: userId } },
      group: { connect: { id: groupId } },
      transaction: { connect: { id: transaction.id } },
    });

    await this.groupDebtService.updateRemainingDebts(groupId);

    const member = foundGroup.members.find(
      (member) => member.userId === userId,
    );
    const receiversIds = groupMembersIds.filter((id) => id !== userId);
    this.sse.emit(
      receiversIds,
      SseEventType.TRANSACTION_ADDED,
      `${member?.user.name} added ${transaction.description}`,
    );

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    this.push.sendToUsers(receiversIds, {
      title: foundGroup.name,
      body: `${user?.name} added "${transaction.description}"`,
      data: {
        type: 'TRANSACTION_ADDED',
        groupId: foundGroup.id,
        transactionId: transaction.id,
      },
    });

    return transaction;
  }

  async updateTransaction(
    id: string,
    userId: string,
    groupId: string,
    amount: number,
    description: string,
    category: TransactionCategory,
    paidBy: string,
    splits: { userId: string; amount: number }[],
  ) {
    const foundGroup = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: { members: { include: { user: true } } },
    });
    if (!foundGroup) throw new NotFoundException('Group not found');

    const groupMemebersIds = foundGroup.members.map((member) => member.userId);
    if (!groupMemebersIds.includes(userId))
      throw new ForbiddenException('You are not a member of this group');

    const unitAmount = toMinorUnit(amount, foundGroup.currency);
    const splitsTotal = splits.reduce(
      (acc, curr) => acc + toMinorUnit(curr.amount, foundGroup.currency),
      0,
    );

    if (splitsTotal !== unitAmount)
      throw new ForbiddenException(
        'The sum of the splits must be equal to total amount',
      );

    const updatedSplits = splits.map(({ userId, amount }) => ({
      where: { userId },
      data: { amount },
    }));

    const transaction = await this.prisma.transaction.update({
      where: { id },
      data: {
        amount,
        description,
        category,
        paidById: paidBy,
        splits: {
          updateMany: updatedSplits,
        },
      },
    });

    await this.groupDebtService.updateRemainingDebts(groupId);

    await this.activityLogsService.createActivityLog({
      action: 'TRANSACTION_UPDATED',
      snapshot: { group: foundGroup, transaction },
      user: { connect: { id: userId } },
      group: { connect: { id: groupId } },
      transaction: { connect: { id: transaction.id } },
    });

    const receivers = groupMemebersIds.filter((id) => id !== userId);
    const updater = foundGroup.members.find(
      (member) => member.userId === userId,
    );

    this.sse.emit(
      receivers,
      SseEventType.TRANSACTION_UPDATED,
      `${updater?.user.name} updated ${transaction.description}`,
    );

    return transaction;
  }

  async deleteTransaction(userId: string, id: string) {
    try {
      const transaction = await this.prisma.transaction.delete({
        where: { id, splits: { some: { userId } } },
        include: { group: true, splits: { include: { user: true } } },
      });

      const { group, ...rest } = transaction;

      await this.groupDebtService.updateRemainingDebts(group.id);

      await this.activityLogsService.createActivityLog({
        action: 'TRANSACTION_DELETED',
        snapshot: { group, transaction: rest },
        user: { connect: { id: userId } },
        group: { connect: { id: transaction.group.id } },
      });

      const receivers = transaction.splits
        .filter((split) => split.userId !== userId)
        .map((split) => split.userId);
      const user = transaction.splits.find((split) => split.userId === userId);

      this.sse.emit(
        receivers,
        SseEventType.TRANSACTION_DELETED,
        `${user?.user.name} deleted ${transaction.description}`,
      );

      return transaction;
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(
            "Transaction not found or you don't have access",
          );
        }
      }
    }
  }

  async settle(
    userId: string,
    body: {
      groupId: string;
      amount: number;
      description: string;
      paidBy: string;
    },
  ) {
    try {
      const { amount, description, groupId, paidBy } = body;

      const res = await this.prisma.transaction.create({
        data: {
          amount,
          description,
          group: { connect: { id: groupId } },
          createdBy: { connect: { id: userId } },
          paidBy: { connect: { id: paidBy } },
          splits: { create: { amount, user: { connect: { id: userId } } } },
          type: 'SETTLEMENT',
        },
        include: {
          group: { include: { members: true } },
          createdBy: true,
          paidBy: true,
        },
      });

      await this.groupDebtService.updateRemainingDebts(groupId);

      await this.activityLogsService.createActivityLog({
        action: 'TRANSACTION_SETTLED',
        user: { connect: { id: userId } },
        targetUser: { connect: { id: paidBy } },
        snapshot: { group: res.group },
      });

      const membersIds = res.group.members.map(({ userId }) => userId);

      this.sse.emit(
        membersIds,
        SseEventType.TRANSACTION_SETTLED,
        `${res.createdBy.name} and ${res.paidBy.name} have settled up `,
      );

      return res;
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(
            "Transaction not found or you don't have access",
          );
        }
      }
    }
  }
}
