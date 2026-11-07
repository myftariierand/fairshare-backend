import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { BugStatus, Severity } from '@prisma/client';

import { PageSchema } from 'src/schema/common';

const AdminActivitiesQuerySchema = z.object({
  page: PageSchema.default(1),
  limit: z.coerce.number().int().min(1).max(500).default(25),
});

export type AdminActivitiesQuery = z.infer<typeof AdminActivitiesQuerySchema>;

export class AdminActivitiesQueryDto extends createZodDto(
  AdminActivitiesQuerySchema,
) {}

const UpdateBugReportSchema = z
  .object({
    status: z.nativeEnum(BugStatus).optional(),
    severity: z.nativeEnum(Severity).optional(),
  })
  .refine(({ status, severity }) => status || severity, 'Nothing to update');

export class UpdateBugReportDto extends createZodDto(UpdateBugReportSchema) {}
