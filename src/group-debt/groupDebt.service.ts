import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DatabaseService } from 'src/database/database.service';

import { BalanceUtil } from 'src/helpers/balance.util';

@Injectable()
export class GroupDebtService {
  constructor(private readonly prisma: DatabaseService) {}

  // Anything that reads a group's balances and then acts on them runs here. A transaction alone
  // wouldn't help: two requests could both read the same debt and both settle it. The row lock
  // makes them take turns. The timeouts allow for waiting behind others in a busy group.
  withGroupLock<T>(
    groupId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "Group" WHERE "id" = ${groupId} FOR UPDATE`;

        return work(tx);
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  async getDebts(
    groupId: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const group = await client.group.findUnique({
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

  async hasOpenDebts(
    groupId: string,
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const debts = await this.getDebts(groupId, client);

    return !!debts?.some((d) => d.from.id === userId || d.to.id === userId);
  }

  async updateRemainingDebts(
    groupId: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const debts = await this.getDebts(groupId, client);

    if (!debts) {
      return null;
    }

    return client.group.update({
      where: { id: groupId },
      data: {
        remainingDebts: debts.length,
      },
    });
  }
}
