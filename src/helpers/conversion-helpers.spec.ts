import { Prisma } from '@prisma/client';

import { AmountSchema } from 'src/schema/common';

import { balanceOf, fitsCurrency, toMinorUnit } from './conversion-helpers';

const split = (userId: string, amount: number) => ({
  userId,
  amount: new Prisma.Decimal(amount),
});

describe('balanceOf', () => {
  it('adds without float errors', () => {
    const splits = [split('b', 0.1), split('c', 0.1), split('d', 0.1)];

    expect(balanceOf('a', 'a', splits)).toBe(0.3);
  });

  it("leaves out the payer's own share", () => {
    expect(balanceOf('a', 'a', [split('a', 5), split('b', 5)])).toBe(5);
  });

  it('is negative for someone who owes', () => {
    expect(balanceOf('b', 'a', [split('a', 5), split('b', 2.5)])).toBe(-2.5);
  });

  it('is zero for someone not in the split', () => {
    expect(balanceOf('z', 'a', [split('b', 5)])).toBe(-0);
  });
});

describe('fitsCurrency', () => {
  it.each([
    [10.5, 'EUR', true],
    [10.5, 'JPY', false],
    [10, 'JPY', true],
    [10.5, 'KRW', false],
    [10.5, 'KWD', true],
  ])('%d in %s: %s', (amount, currency, fits) => {
    expect(fitsCurrency(amount, currency)).toBe(fits);
  });
});

describe('toMinorUnit', () => {
  it.each([
    [4.35, 435],
    [0.07, 7],
    [1.1, 110],
    [19.99, 1999],
    [99_999_999.99, 9_999_999_999],
  ])('%d is exact', (amount, cents) => {
    expect(toMinorUnit(amount, 'EUR')).toBe(cents);
  });

  it('has no decimals in a currency without them', () => {
    expect(toMinorUnit(1000, 'JPY')).toBe(1000);
  });
});

describe('AmountSchema', () => {
  it.each([0.01, 0.07, 4.35, 19.99, 99_999_999.99])('accepts %d', (amount) => {
    expect(AmountSchema.safeParse(amount).success).toBe(true);
  });

  it.each([0, -1, 0.001, 12.345, 0.1 + 0.2, 100_000_000, Infinity, NaN])(
    'refuses %d',
    (amount) => {
      expect(AmountSchema.safeParse(amount).success).toBe(false);
    },
  );
});
