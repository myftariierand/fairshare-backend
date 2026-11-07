import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

import { EmailSchema, text } from 'src/schema/common';

export const SeverityEnum = z.enum(['CRITICAL', 'MAJOR', 'MINOR', 'COSMETIC']);

export const CreateBugReportSchema = z.object({
  title: text(200, 3),
  description: text(5000, 10),
  severity: SeverityEnum.default('MINOR'),
  // Both forms may send these blank
  name: text(100, 0).optional(),
  email: EmailSchema.or(z.literal('')).optional(),
  device: text(500, 0).optional(),
});

export class CreateBugReportDto extends createZodDto(CreateBugReportSchema) {}
