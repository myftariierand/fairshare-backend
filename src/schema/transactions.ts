import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const CreateTransactionSchema = z
  .object({
    groupId: z.string().uuid(),
    amount: z.number().positive(),
    description: z.string().min(4),
    paidBy: z.string().uuid(),
    splits: z
      .array(
        z.object({
          userId: z.string().uuid(),
          amount: z.number().positive(),
        }),
      )
      .min(1),
  })
  .refine(
    ({ amount, splits }) => {
      const splitsAmount = splits.reduce(
        (acc, split) => (acc += split.amount),
        0,
      );

      const difference = Math.abs(amount - splitsAmount);

      return difference < 0.02;
    },
    {
      message: 'The sum of all splits should be equal to total amount',
    },
  );

export class CreateTransactionDto extends createZodDto(
  CreateTransactionSchema,
) {}

const UpdateTransactionParamsSchema = z.object({
  id: z.string().uuid(),
});

export class UpdateTransactionParamsDto extends createZodDto(
  UpdateTransactionParamsSchema,
) {}

const UpdateTransactionSchema = z
  .object({
    groupId: z.string().uuid(),
    amount: z.number().positive(),
    description: z.string().min(4),
    splits: z
      .array(
        z.object({
          userId: z.string().uuid(),
          amount: z.number().positive(),
        }),
      )
      .min(1),
  })
  .refine(
    ({ amount, splits }) => {
      if (splits?.length) {
        const splitsAmount = splits.reduce(
          (acc, split) => (acc += split.amount),
          0,
        );

        const difference = Math.abs(amount - splitsAmount);

        return difference < 0.02;
      }
    },
    {
      message: 'The sum of all splits should be equal to total amount',
    },
  );

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
