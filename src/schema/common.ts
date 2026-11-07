import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { Prisma } from '@prisma/client';

// Postgres can't store a NUL byte, so letting one through ends in a 500
export const text = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !value.includes('\0'), 'Invalid text');

export const NameSchema = text(100);

export const EmailSchema = z.string().email().max(254);

const CURRENCIES = new Set<string>((Intl as any).supportedValuesOf('currency'));

// The clients format amounts with Intl, which throws on a code it doesn't know
export const CurrencySchema = z
  .string()
  .refine((code) => CURRENCIES.has(code), 'Unknown currency');

// What a Decimal(10, 2) column holds. Going through Decimal reads the number the way it was written,
// so 0.07 counts as two places even though it isn't exact as a float.
export const AmountSchema = z
  .number()
  .positive()
  .max(99_999_999.99)
  .refine(
    (amount) => new Prisma.Decimal(amount).decimalPlaces() <= 2,
    'Use at most 2 decimal places',
  );

// Query values always arrive as text. The upper limit keeps the offset within what the database takes.
export const PageSchema = z.coerce.number().int().min(1).max(1_000_000);

const IdParamsSchema = z.object({ id: z.string().uuid() });

export class IdParamsDto extends createZodDto(IdParamsSchema) {}
