import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class TransactionsService {
  constructor(private prisma: DatabaseService) {}

  async findTransactions(userId: string, groupId: string) {
    return this.prisma.transaction.findMany({
      where: { groupId, group: { members: { some: { userId } } } },
    });
  }

  async createTransaction(
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

    return this.prisma.transaction.create({
      data: {
        amount,
        description,
        createdBy: {
          connect: {
            id: userId,
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
