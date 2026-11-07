import { Prisma } from '@prisma/client';

export const currencyDecimals: Record<string, number> = {
  EUR: 2, // eurocents
  ALL: 2, // qindarka (but rarely used)
  USD: 2, // cents
  GBP: 2, // pence
  JPY: 0, // no decimals
  CHF: 2, // rappen
  CNY: 2, // jiao/fen
  INR: 2, // paise
};

// Other codes are valid too, if not offered by the clients. Amounts are stored with two decimals
// at most, whatever the currency normally uses.
const decimalsOf = (currency: string) =>
  currencyDecimals[currency] ??
  Math.min(
    2,
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2,
  );

// Assumes the amount already passed AmountSchema, so only the currency's own limit is left
export function fitsCurrency(amount: number, currency: string): boolean {
  return decimalsOf(currency) > 0 || Number.isInteger(amount);
}

// What someone gained or owes from one transaction. Added as decimals, because adding floats
// turns three splits of 0.1 into 0.30000000000000004.
export function balanceOf(
  userId: string,
  paidById: string,
  splits: { userId: string; amount: Prisma.Decimal }[],
): number {
  if (paidById !== userId) {
    const own = splits.find((split) => split.userId === userId);

    return -(own?.amount.toNumber() ?? 0);
  }

  return splits
    .filter((split) => split.userId !== userId)
    .reduce((sum, split) => sum.add(split.amount), new Prisma.Decimal(0))
    .toNumber();
}

export function toMinorUnit(amount: number, currency: string): number {
  const decimals = decimalsOf(currency);
  return Math.round(amount * Math.pow(10, decimals));
}

export function fromMinorUnit(amount: number, currency: string): string {
  const decimals = decimalsOf(currency);
  return (amount / Math.pow(10, decimals)).toFixed(decimals);
}

export function splitAmount(
  amount: number,
  userIds: string[],
): { userId: string; amount: number }[] {
  const n = userIds.length;
  const base = Math.floor(amount / n);
  const remainder = amount % n;

  return userIds.map((id, i) => ({
    userId: id,
    amount: base + (i < remainder ? 1 : 0), // distribute remainder
  }));
}
