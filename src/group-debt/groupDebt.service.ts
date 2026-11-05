import { Injectable } from '@nestjs/common';

import { DatabaseService } from 'src/database/database.service';

import { BalanceUtil } from 'src/helpers/balance.util';

@Injectable()
export class GroupDebtService {
  constructor(private readonly prisma: DatabaseService) {}

  async getDebts(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: {
        id: groupId,
      },
      include: {
        transactions: {
          include: {
            splits: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            paidBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!group) {
      return null;
    }

    return BalanceUtil.simplifyBalances(group.transactions);
  }

  async hasOpenDebts(groupId: string, userId: string) {
    const debts = await this.getDebts(groupId);

    return !!debts?.some((d) => d.from.id === userId || d.to.id === userId);
  }

  async updateRemainingDebts(groupId: string) {
    const debts = await this.getDebts(groupId);

    if (!debts) {
      return null;
    }

    return this.prisma.group.update({
      where: { id: groupId },
      data: {
        remainingDebts: debts.length,
      },
    });
  }
}
