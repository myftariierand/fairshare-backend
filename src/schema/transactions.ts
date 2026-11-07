import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

import { TransactionCategory } from '@prisma/client';

import { AmountSchema, text } from 'src/schema/common';

const DescriptionSchema = text(255, 4);

const CreateTransactionSchema = z.object({
  // Set by the client once per expense it means to add, so sending it again can't add a second one
  idempotencyKey: z.string().min(8).max(64).optional(),
  groupId: z.string().uuid(),
  amount: AmountSchema,
  category: z.nativeEnum(TransactionCategory),
  description: DescriptionSchema,
  paidBy: z.string().uuid(),
  splits: z.array(
    z.object({
      userId: z.string().uuid(),
      amount: AmountSchema,
    }),
  ),
});

export class CreateTransactionDto extends createZodDto(
  CreateTransactionSchema,
) {}

const UpdateTransactionParamsSchema = z.object({
  id: z.string().uuid(),
});

export class UpdateTransactionParamsDto extends createZodDto(
  UpdateTransactionParamsSchema,
) {}

const UpdateTransactionSchema = z.object({
  groupId: z.string().uuid(),
  amount: AmountSchema,
  category: z.nativeEnum(TransactionCategory),
  description: DescriptionSchema,
  paidBy: z.string().uuid(),
  splits: z.array(
    z.object({
      userId: z.string().uuid(),
      amount: AmountSchema,
    }),
  ),
});

export class UpdateTransactionDto extends createZodDto(
  UpdateTransactionSchema,
) {}

const DeleteTransactionParamsSchema = z.object({
  id: z.string().uuid(),
});

export class DeleteTransactionParamsDto extends createZodDto(
  DeleteTransactionParamsSchema,
) {}

const GetTransactionParamsSchema = z.object({
  groupId: z.string().uuid(),
});

export class GetTransactionParamsDto extends createZodDto(
  GetTransactionParamsSchema,
) {}

const GetTransactionByIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export class GetTransactionByIdParamsDto extends createZodDto(
  GetTransactionByIdParamsSchema,
) {}

const SettleDebtBodySchema = z.object({
  groupId: z.string().uuid(),
  amount: AmountSchema,
  description: DescriptionSchema,
  paidBy: z.string().uuid(),
});

export class SettleDebtBodyDto extends createZodDto(SettleDebtBodySchema) {}
