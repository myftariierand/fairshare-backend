import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

// import { Prisma } from '@prisma/client';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class TransactionsService {
  constructor(private prisma: DatabaseService) {}

  // calculateBalances(
  //   transactions: Prisma.TransactionGetPayload<{ include: { splits: true } }>[],
  // ) {
  //   const balances: Record<string, number> = {};

  //   transactions.forEach((transaction) => {
  //     const { paidById, amount, splits } = transaction;

  //     if (!balances[paidById]) balances[paidById] = 0;

  //     balances[paidById] += amount;

  //     splits.forEach((split) => {
  //       if (!balances[split.userId]) balances[split.userId] = 0;

  //       balances[split.userId] -= split.amount;
  //     });
  //   });

  //   return balances;
  // }

  async findTransactions(userId: string, groupId: string) {
    const response = await this.prisma.transaction.findMany({
      where: { groupId, group: { members: { some: { userId } } } },
      orderBy: { createdAt: 'desc' },
      include: { splits: true, paidBy: true },
    });

    return response.map(
      ({ id, description, createdAt, amount, paidBy, splits, paidById }) => {
        const userSplit = splits.find((split) => split.userId === userId);

        const balance =
          paidById === userId
            ? splits.reduce(
                (sum, split) =>
                  sum + (split.userId !== userId ? split.amount : 0),
                0,
              )
            : -(userSplit?.amount ?? 0);

        return {
          id,
          description,
          paidBy: paidBy.id === userId ? 'You' : paidBy.name,
          createdAt,
          balance,
          amount,
        };
      },
    );
  }

  async findTransactionById(userId: string, id: string) {
    return this.prisma.transaction.findUnique({
      where: {
        id,
        splits: { some: { userId } },
      },
      include: {
        paidBy: true,
        createdBy: true,
        splits: {
          include: { user: true },
        },
      },
    });
  }

  async createTransaction(
    userId: string,
    groupId: string,
    amount: number,
    description: string,
    paidBy: string,
    splits: { userId: string; amount: number }[],
  ) {
    const foundGroup = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: { members: true },
    });
    if (!foundGroup) throw new NotFoundException('Group not found');

    const groupMemebersIds = foundGroup.members.map((member) => member.userId);
    if (!groupMemebersIds.includes(userId))
      throw new ForbiddenException('You are not a member of this group');

    const userIds = splits.map((split) => split.userId);
    if (groupMemebersIds.length !== userIds.length)
      throw new ForbiddenException('All users should be members of the group');

    return this.prisma.transaction.create({
      data: {
        amount,
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
  }

  async updateTransaction(
    id: string,
    userId: string,
    groupId: string,
    amount: number,
    description: string,
    splits: { userId: string; amount: number }[],
  ) {
    const foundGroup = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: { members: true },
    });
    if (!foundGroup) throw new NotFoundException('Group not found');

    const groupMemebersIds = foundGroup.members.map((member) => member.userId);
    if (!groupMemebersIds.includes(userId))
      throw new ForbiddenException('You are not a member of this group');

    const userIds = splits.map((split) => split.userId);
    if (groupMemebersIds.length !== userIds.length)
      throw new ForbiddenException('All users should be members of the group');

    const updatedSplits = splits.map(({ userId, amount }) => ({
      where: { userId },
      data: { amount },
    }));

    return this.prisma.transaction.update({
      where: { id },
      data: {
        amount,
        description,
        splits: {
          updateMany: updatedSplits,
        },
      },
    });
  }

  async deleteTransaction(userId: string, id: string) {
    try {
      return await this.prisma.transaction.delete({
        where: { id, splits: { some: { userId } } },
      });
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
