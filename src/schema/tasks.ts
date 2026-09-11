import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const CreateTaskSchema = z.object({
  text: z.string(),
});

export class CreateTaskDto extends createZodDto(CreateTaskSchema) {}

const UpdateTaskSchema = z.object({
  text: z.string().optional(),
  done: z.boolean().optional(),
});

export class UpdateTaskDto extends createZodDto(UpdateTaskSchema) {}

const ReorderTasksSchema = z.object({
  orderedIds: z.string().array(),
});

export class ReorderTasksDto extends createZodDto(ReorderTasksSchema) {}
