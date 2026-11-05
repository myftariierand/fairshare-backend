import { Prisma, TransactionType } from '@prisma/client';

import { BalanceUtil } from './balance.util';

const person = (id: string) => ({ id, name: id.toUpperCase() });

const transaction = (
  type: TransactionType,
  paidById: string,
  splits: [string, number][],
) =>
  ({
    type,
    paidById,
    paidBy: person(paidById),
    splits: splits.map(([userId, amount]) => ({
      userId,
      amount: new Prisma.Decimal(amount),
      user: person(userId),
    })),
  }) as unknown as Parameters<typeof BalanceUtil.simplifyBalances>[0][number];

const expense = (paidById: string, splits: [string, number][]) =>
  transaction(TransactionType.EXPENSE, paidById, splits);

// A settlement is paid by the debtor, and its split names the person repaid
const payment = (from: string, to: string, amount: number) =>
  transaction(TransactionType.SETTLEMENT, from, [[to, amount]]);

const debts = (transactions: ReturnType<typeof expense>[]) =>
  BalanceUtil.simplifyBalances(transactions).map(
    ({ from, to, amount }) => `${from.id}->${to.id}:${amount}`,
  );

describe('BalanceUtil.simplifyBalances', () => {
  it('has no debts for an empty group', () => {
    expect(debts([])).toEqual([]);
  });

  it('ignores the share the payer owes themselves', () => {
    expect(
      debts([
        expense('a', [
          ['a', 10],
          ['b', 10],
        ]),
      ]),
    ).toEqual(['b->a:10']);
  });

  it('nets debts that go both ways', () => {
    expect(
      debts([expense('a', [['b', 10]]), expense('b', [['a', 4]])]),
    ).toEqual(['b->a:6']);
  });

  it('reduces a debt by a partial payment', () => {
    expect(debts([expense('a', [['b', 10]]), payment('b', 'a', 4)])).toEqual([
      'b->a:6',
    ]);
  });

  it('clears a debt that is paid in full', () => {
    expect(debts([expense('a', [['b', 10]]), payment('b', 'a', 10)])).toEqual(
      [],
    );
  });

  it('keeps a payment counted when later expenses change who owes whom', () => {
    expect(
      debts([
        expense('b', [['a', 10]]),
        payment('a', 'b', 10),
        expense('c', [['b', 10]]),
      ]),
    ).toEqual(['b->c:10']);
  });

  it('counts a payment between people the suggestions did not pair', () => {
    expect(
      debts([
        expense('c', [['a', 10]]),
        expense('d', [['b', 10]]),
        payment('a', 'd', 10),
      ]),
    ).toEqual(['b->c:10']);
  });

  it('gives the same result whatever order the rows come back in', () => {
    const first = expense('c', [
      ['a', 5],
      ['b', 5],
    ]);
    const second = expense('d', [
      ['a', 5],
      ['b', 5],
    ]);
    const paid = payment('a', 'c', 10);

    expect(debts([first, second, paid])).toEqual(debts([second, first, paid]));
    expect(debts([first, second, paid])).toEqual(debts([paid, second, first]));
  });

  it('adds up decimals exactly', () => {
    expect(
      debts([
        expense('a', [['b', 0.1]]),
        expense('a', [['b', 0.1]]),
        expense('a', [['b', 0.1]]),
      ]),
    ).toEqual(['b->a:0.3']);
  });

  it('leaves no debt behind for amounts that cancel out', () => {
    expect(
      debts([
        expense('a', [['b', 0.1]]),
        expense('a', [['b', 0.2]]),
        payment('b', 'a', 0.3),
      ]),
    ).toEqual([]);
  });

  it('settles everything between several people', () => {
    const result = BalanceUtil.simplifyBalances([
      expense('a', [
        ['b', 33.33],
        ['c', 33.33],
        ['d', 33.34],
      ]),
      expense('b', [
        ['a', 12.5],
        ['c', 12.5],
      ]),
    ]);

    const total = (id: string) =>
      result.reduce(
        (sum, { from, to, amount }) =>
          sum +
          Math.round(amount * 100) *
            (to.id === id ? 1 : from.id === id ? -1 : 0),
        0,
      );

    expect(total('a')).toBe(8750);
    expect(total('b')).toBe(-833);
    expect(total('c')).toBe(-4583);
    expect(total('d')).toBe(-3334);
  });
});

describe('BalanceUtil with people who have left the group', () => {
  it('keeps them in the debts, by name', () => {
    const [debt] = BalanceUtil.simplifyBalances([expense('a', [['gone', 10]])]);

    expect(debt.from).toEqual({ id: 'gone', name: 'GONE' });
    expect(debt.to).toEqual({ id: 'a', name: 'A' });
  });

  it('does not throw for raw balances', () => {
    const [balance] = BalanceUtil.calculateGroupBalances([
      expense('gone', [['a', 10]]),
    ]);

    expect(balance.to).toEqual({ id: 'gone', name: 'GONE' });
    expect(balance.amount).toBe(10);
  });
});

describe('BalanceUtil.calculateGroupBalances', () => {
  it('lists expenses without netting and leaves out settlements', () => {
    const balances = BalanceUtil.calculateGroupBalances([
      expense('a', [['b', 10]]),
      expense('b', [['a', 4]]),
      payment('b', 'a', 3),
    ]);

    expect(
      balances.map(({ from, to, amount }) => `${from.id}->${to.id}:${amount}`),
    ).toEqual(['b->a:10', 'a->b:4']);
  });
});
