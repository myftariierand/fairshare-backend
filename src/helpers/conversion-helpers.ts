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

export function toMinorUnit(amount: number, currency: string): number {
  const decimals = currencyDecimals[currency] ?? 2;
  return Math.round(amount * Math.pow(10, decimals));
}

export function fromMinorUnit(amount: number, currency: string): string {
  const decimals = currencyDecimals[currency] ?? 2;
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
