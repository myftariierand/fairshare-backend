import { Prisma, User, TransactionType } from '@prisma/client';

type Balance = {
  from: {
    id: string;
    name: string;
  };
  to: {
    id: string;
    name: string;
  };
  amount: number;
};

type Transaction = Prisma.TransactionGetPayload<{
  include: {
    splits: { include: { user: { select: { id: true; name: true } } } };
    paidBy: { select: { id: true; name: true } };
  };
}>;

export class BalanceUtil {
  // ------------------------
  // 1. Calculate raw balances
  // ------------------------
  static calculateGroupBalances(
    transactions: Transaction[],
    users: User[],
  ): Balance[] {
    const balances: Record<string, Record<string, number>> = {};
    const userMap: Record<string, User> = {};

    for (const user of users) userMap[user.id] = user;

    const addBalance = (from: string, to: string, amount: number) => {
      if (!balances[from]) balances[from] = {};
      if (!balances[to]) balances[to] = {};
      balances[from][to] = (balances[from][to] || 0) + amount;
    };

    for (const transaction of transactions) {
      if (transaction.type === TransactionType.EXPENSE) {
        for (const split of transaction.splits) {
          if (split.userId !== transaction.paidById) {
            addBalance(
              split.userId,
              transaction.paidById,
              split.amount.toNumber(),
            );
          }
        }
      }
    }

    // Convert to array without netting
    const result: Balance[] = [];
    for (const from in balances) {
      for (const to in balances[from]) {
        const amount = balances[from][to];
        if (amount !== 0) {
          result.push({
            from: userMap[from],
            to: userMap[to],
            amount,
          });
        }
      }
    }

    return result;
  }

  // ------------------------
  // 2. Simplify balances
  // ------------------------
  static simplifyBalances(
    balances: Balance[],
    transactions: Transaction[],
  ): Balance[] {
    const net: Record<string, { name: string; balance: number }> = {};

    for (const b of balances) {
      if (!net[b.from.id]) net[b.from.id] = { name: b.from.name, balance: 0 };
      if (!net[b.to.id]) net[b.to.id] = { name: b.to.name, balance: 0 };

      net[b.from.id].balance -= b.amount;
      net[b.to.id].balance += b.amount;
    }

    const debtors: { id: string; name: string; balance: number }[] = [];
    const creditors: { id: string; name: string; balance: number }[] = [];

    for (const [id, { name, balance }] of Object.entries(net)) {
      if (balance < 0) debtors.push({ id, name, balance });
      else if (balance > 0) creditors.push({ id, name, balance });
    }

    const simplified: Balance[] = [];
    let i = 0,
      j = 0;

    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];
      const settleAmount = Math.min(-debtor.balance, creditor.balance);

      simplified.push({
        from: { id: debtor.id, name: debtor.name },
        to: { id: creditor.id, name: creditor.name },
        amount: settleAmount,
      });

      debtor.balance += settleAmount;
      creditor.balance -= settleAmount;

      if (debtor.balance === 0) i++;
      if (creditor.balance === 0) j++;
    }

    for (const tx of transactions) {
      if (tx.type === TransactionType.SETTLEMENT) {
        if (tx.splits.length !== 1)
          throw new Error('Settlement must have 1 split');

        const payer = tx.paidById;
        const receiver = tx.splits[0].userId;
        const amount = tx.amount.toNumber();

        let balance = simplified.find(
          (b) => b.from.id === payer && b.to.id === receiver,
        );

        if (balance) {
          balance.amount = Math.max(0, balance.amount - amount);
          continue;
        }

        balance = simplified.find(
          (b) => b.from.id === receiver && b.to.id === payer,
        );

        if (balance) {
          balance.amount = Math.max(0, balance.amount - amount);
          continue;
        }
      }
    }

    return simplified
      .map((b) => ({ ...b, amount: b.amount.toFixed(2) }))
      .filter((b) => +b.amount > 0)
      .map((b) => ({ ...b, amount: +b.amount }));
  }
}
