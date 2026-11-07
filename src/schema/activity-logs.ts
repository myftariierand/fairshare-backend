import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

import { PageSchema } from 'src/schema/common';

const GetActivityQuerySchema = z.object({ page: PageSchema.optional() });

export type GetActivityQuery = z.infer<typeof GetActivityQuerySchema>;

export class GetActivityQueryDto extends createZodDto(GetActivityQuerySchema) {}
