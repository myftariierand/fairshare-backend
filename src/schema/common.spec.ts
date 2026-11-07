import { CurrencySchema, PageSchema, text } from './common';

describe('text', () => {
  it('trims before checking the length', () => {
    expect(text(5).parse('  abc  ')).toBe('abc');
    expect(text(5).safeParse('   ').success).toBe(false);
  });

  it('enforces the limits', () => {
    expect(text(3).safeParse('abc').success).toBe(true);
    expect(text(3).safeParse('abcd').success).toBe(false);
    expect(text(5, 4).safeParse('abc').success).toBe(false);
  });

  it('can allow blank', () => {
    expect(text(5, 0).parse('')).toBe('');
  });

  it('refuses a NUL byte', () => {
    expect(text(5).safeParse('a\0b').success).toBe(false);
  });
});

describe('CurrencySchema', () => {
  it.each(['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'ALL'])('accepts %s', (code) => {
    expect(CurrencySchema.safeParse(code).success).toBe(true);
  });

  it.each(['FAKE!', 'eur', 'EURO', ''])('refuses "%s"', (code) => {
    expect(CurrencySchema.safeParse(code).success).toBe(false);
  });

  it('only accepts what Intl can format', () => {
    for (const code of ['EUR', 'JPY']) {
      expect(() =>
        new Intl.NumberFormat('en', {
          style: 'currency',
          currency: code,
        }).format(1),
      ).not.toThrow();
    }
  });
});

describe('PageSchema', () => {
  it('reads numbers out of query text', () => {
    expect(PageSchema.parse('2')).toBe(2);
  });

  it.each(['-5', '0', '1.5', 'abc', '', '1e30'])('refuses "%s"', (value) => {
    expect(PageSchema.safeParse(value).success).toBe(false);
  });
});
