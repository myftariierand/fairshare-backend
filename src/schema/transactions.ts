import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

import { TransactionCategory } from '@prisma/client';

const CreateTransactionSchema = z.object({
  groupId: z.string().uuid(),
  amount: z.number().positive(),
  category: z.nativeEnum(TransactionCategory),
  description: z.string().min(4),
  paidBy: z.string().uuid(),
  splits: z.array(
    z.object({
      userId: z.string().uuid(),
      amount: z.number().positive(),
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
  amount: z.number().positive(),
  category: z.nativeEnum(TransactionCategory),
  description: z.string().min(4),
  paidBy: z.string().uuid(),
  splits: z.array(
    z.object({
      userId: z.string().uuid(),
      amount: z.number().positive(),
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
  amount: z.number().positive(),
  description: z.string().min(4),
  paidBy: z.string().uuid(),
});

export class SettleDebtBodyDto extends createZodDto(SettleDebtBodySchema) {}
