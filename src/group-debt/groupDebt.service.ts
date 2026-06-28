import { Injectable } from '@nestjs/common';

import { DatabaseService } from 'src/database/database.service';

import { BalanceUtil } from 'src/helpers/balance.util';

@Injectable()
export class GroupDebtService {
  constructor(private readonly prisma: DatabaseService) {}

  async updateRemainingDebts(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: {
        id: groupId,
      },
      include: {
        members: {
          include: {
            user: true,
          },
        },
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
        createdBy: true,
      },
    });

    if (!group) {
      return null;
    }

    const balances = BalanceUtil.calculateGroupBalances(
      group.transactions,
      group.members.map((m) => m.user),
    );

    const settlements = BalanceUtil.simplifyBalances(
      balances,
      group.transactions,
    );

    return this.prisma.group.update({
      where: { id: group.id },
      data: {
        remainingDebts: settlements.length,
      },
    });
  }
}
