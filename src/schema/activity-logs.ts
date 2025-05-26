import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const GetActivityQuerySchema = z.object({ page: z.coerce.number().optional() });

export type GetActivityQuery = z.infer<typeof GetActivityQuerySchema>;

export class GetActivityQueryDto extends createZodDto(GetActivityQuerySchema) {}
