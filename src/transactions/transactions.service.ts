import {
  BadRequestException,
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
import { TransactionCategory, TransactionType } from '@prisma/client';

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

    const userIds = [paidBy, ...splits.map((split) => split.userId)];
    const allUsersAreMembers = userIds.every((userId) =>
      groupMembersIds.includes(userId),
    );
    if (!allUsersAreMembers)
      throw new ForbiddenException('All users should be members of the group');

    this.assertNoDuplicateSplits(splits);

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
        type: SseEventType.TRANSACTION_ADDED,
        groupId: foundGroup.id,
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

    // The membership check above is only about this group, so the expense must belong to it.
    // Settlements record a payment and can't be edited into something else.
    const existing = await this.prisma.transaction.findFirst({
      where: { id, groupId, type: 'EXPENSE' },
      include: { splits: true },
    });
    if (!existing) throw new NotFoundException('Transaction not found');

    this.assertCanManage(existing, foundGroup.createdById, userId);

    // Someone who has left can stay on an old expense, but can't be added to one
    if (paidBy !== existing.paidById && !groupMemebersIds.includes(paidBy))
      throw new ForbiddenException('The payer must be a member of the group');

    const allowedInSplits = new Set([
      ...groupMemebersIds,
      ...existing.splits.map((split) => split.userId),
    ]);
    if (!splits.every((split) => allowedInSplits.has(split.userId)))
      throw new ForbiddenException('All users should be members of the group');

    this.assertNoDuplicateSplits(splits);

    const unitAmount = toMinorUnit(amount, foundGroup.currency);
    const splitsTotal = splits.reduce(
      (acc, curr) => acc + toMinorUnit(curr.amount, foundGroup.currency),
      0,
    );

    if (splitsTotal !== unitAmount)
      throw new ForbiddenException(
        'The sum of the splits must be equal to total amount',
      );

    // Replaced rather than updated, because an edit can add people or take them off
    const [, transaction] = await this.prisma.$transaction([
      this.prisma.transactionSplit.deleteMany({ where: { transactionId: id } }),
      this.prisma.transaction.update({
        where: { id },
        data: {
          amount,
          description,
          category,
          paidById: paidBy,
          splits: {
            createMany: { data: splits },
          },
        },
      }),
    ]);

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

    this.push.sendToUsers(receivers, {
      title: foundGroup.name,
      body: `${updater?.user.name} updated "${transaction.description}"`,
      data: {
        type: SseEventType.TRANSACTION_UPDATED,
        groupId: foundGroup.id,
      },
    });

    return transaction;
  }

  async deleteTransaction(userId: string, id: string) {
    const existing = await this.prisma.transaction.findFirst({
      where: { id, group: { members: { some: { userId } } } },
      include: { group: { select: { createdById: true } } },
    });
    if (!existing)
      throw new NotFoundException(
        "Transaction not found or you don't have access",
      );

    this.assertCanManage(existing, existing.group.createdById, userId);

    try {
      const transaction = await this.prisma.transaction.delete({
        where: { id },
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

      // Everyone with money in it, including a payer who isn't part of the split
      const receivers = [
        ...new Set([
          transaction.paidById,
          ...transaction.splits.map((split) => split.userId),
        ]),
      ].filter((id) => id !== userId);
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });

      this.sse.emit(
        receivers,
        SseEventType.TRANSACTION_DELETED,
        `${user?.name} deleted ${transaction.description}`,
      );

      this.push.sendToUsers(receivers, {
        title: transaction.group.name,
        body: `${user?.name} deleted "${transaction.description}"`,
        data: {
          type: SseEventType.TRANSACTION_DELETED,
          groupId: transaction.group.id,
        },
      });

      return transaction;
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(
            "Transaction not found or you don't have access",
          );
        }
      }

      throw error;
    }
  }

  // Someone who just owes money can't change or remove the record of it. For a settlement
  // the payer is the debtor, so being the payer only counts on an expense.
  private assertCanManage(
    transaction: {
      type: TransactionType;
      createdById: string;
      paidById: string;
    },
    groupOwnerId: string,
    userId: string,
  ) {
    const canManage =
      transaction.createdById === userId ||
      groupOwnerId === userId ||
      (transaction.type === TransactionType.EXPENSE &&
        transaction.paidById === userId);

    if (!canManage) {
      throw new ForbiddenException(
        'Only the person who added this, the person who paid or the group owner can change it.',
      );
    }
  }

  private assertNoDuplicateSplits(splits: { userId: string }[]) {
    const userIds = splits.map((split) => split.userId);

    if (new Set(userIds).size !== userIds.length) {
      throw new BadRequestException('Each person can only be in a split once');
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
    const { amount, description, groupId, paidBy } = body;

    const group = await this.prisma.group.findUnique({
      where: { id: groupId, members: { some: { userId } } },
      select: { currency: true },
    });
    if (!group)
      throw new ForbiddenException('You are not a member of this group');

    // Only the person owed can mark a debt as paid, and for no more than what is owed
    const debts = await this.groupDebtService.getDebts(groupId);
    const debt = debts?.find((d) => d.from.id === paidBy && d.to.id === userId);
    if (!debt)
      throw new BadRequestException('This person does not owe you anything');

    const unitAmount = toMinorUnit(amount, group.currency);
    if (
      unitAmount <= 0 ||
      unitAmount > toMinorUnit(debt.amount, group.currency)
    )
      throw new BadRequestException(
        'The amount must be more than zero and no more than what is owed',
      );

    try {
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
        `${res.createdBy.name} and ${res.paidBy.name} have settled up`,
      );

      this.push.sendToUsers(membersIds, {
        title: res.group.name,
        body: `${res.createdBy.name} and ${res.paidBy.name} have settled up`,
        data: {
          type: SseEventType.TRANSACTION_SETTLED,
          groupId: res.group.id,
        },
      });

      return res;
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(
            "Transaction not found or you don't have access",
          );
        }
      }

      throw error;
    }
  }
}
