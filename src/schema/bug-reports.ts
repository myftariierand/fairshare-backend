import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const SeverityEnum = z.enum(['CRITICAL', 'MAJOR', 'MINOR', 'COSMETIC']);

export const CreateBugReportSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  severity: SeverityEnum.default('MINOR'),
  name: z.string().optional(),
  email: z.string().email().optional(),
  device: z.string().optional(),
});

export class CreateBugReportDto extends createZodDto(CreateBugReportSchema) {}
