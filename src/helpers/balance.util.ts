import { Prisma, TransactionType } from '@prisma/client';

type Person = {
  id: string;
  name: string;
};

type Balance = {
  from: Person;
  to: Person;
  amount: number;
};

type Transaction = Prisma.TransactionGetPayload<{
  include: {
    splits: { include: { user: { select: { id: true; name: true } } } };
    paidBy: { select: { id: true; name: true } };
  };
}>;

// Amounts are stored with two decimals, so whole cents add up without rounding errors
const toCents = (amount: Prisma.Decimal) => amount.mul(100).toNumber();

// Names come from the transactions, not the member list: people who have left the
// group are still part of its history
const getPeople = (transactions: Transaction[]) => {
  const people = new Map<string, Person>();

  for (const { paidBy, splits } of transactions) {
    people.set(paidBy.id, { id: paidBy.id, name: paidBy.name });
    for (const { user } of splits) {
      people.set(user.id, { id: user.id, name: user.name });
    }
  }

  return people;
};

export class BalanceUtil {
  // ------------------------
  // 1. Calculate raw balances
  // ------------------------
  static calculateGroupBalances(transactions: Transaction[]): Balance[] {
    const people = getPeople(transactions);
    const owed = new Map<string, Map<string, number>>();

    for (const { type, paidById, splits } of transactions) {
      if (type !== TransactionType.EXPENSE) continue;

      for (const { userId, amount } of splits) {
        if (userId === paidById) continue;

        const fromUser = owed.get(userId) ?? new Map<string, number>();
        fromUser.set(paidById, (fromUser.get(paidById) ?? 0) + toCents(amount));
        owed.set(userId, fromUser);
      }
    }

    // Convert to array without netting
    const result: Balance[] = [];
    for (const [from, fromUser] of owed) {
      for (const [to, cents] of fromUser) {
        if (cents !== 0) {
          result.push({
            from: people.get(from)!,
            to: people.get(to)!,
            amount: cents / 100,
          });
        }
      }
    }

    return result;
  }

  // ------------------------
  // 2. Simplify balances
  // ------------------------
  static simplifyBalances(transactions: Transaction[]): Balance[] {
    const people = getPeople(transactions);
    const net = new Map<string, number>();

    // Expenses and settlements net the same way: whoever paid is up by that amount, and
    // whoever the split names is down by it. A settlement's split is the person repaid.
    for (const { paidById, splits } of transactions) {
      for (const { userId, amount } of splits) {
        if (userId === paidById) continue;

        const cents = toCents(amount);
        net.set(paidById, (net.get(paidById) ?? 0) + cents);
        net.set(userId, (net.get(userId) ?? 0) - cents);
      }
    }

    // Biggest amounts first, then by id, so the result doesn't depend on row order
    const byAmount = (a: [string, number], b: [string, number]) =>
      Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]);

    const entries = [...net.entries()].sort(byAmount);
    const debtors = entries.filter(([, cents]) => cents < 0);
    const creditors = entries.filter(([, cents]) => cents > 0);

    const simplified: Balance[] = [];
    let i = 0,
      j = 0;

    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];
      const settleAmount = Math.min(-debtor[1], creditor[1]);

      simplified.push({
        from: people.get(debtor[0])!,
        to: people.get(creditor[0])!,
        amount: settleAmount / 100,
      });

      debtor[1] += settleAmount;
      creditor[1] -= settleAmount;

      if (debtor[1] === 0) i++;
      if (creditor[1] === 0) j++;
    }

    return simplified;
  }
}
