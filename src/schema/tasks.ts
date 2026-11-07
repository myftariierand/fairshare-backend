import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

import { text } from 'src/schema/common';

const TaskTextSchema = text(500);

const TaskParamsSchema = z.object({
  groupId: z.string().uuid(),
  taskId: z.string().uuid(),
});

export class TaskParamsDto extends createZodDto(TaskParamsSchema) {}

const CreateTaskSchema = z.object({
  text: TaskTextSchema,
});

export class CreateTaskDto extends createZodDto(CreateTaskSchema) {}

const UpdateTaskSchema = z.object({
  text: TaskTextSchema.optional(),
  done: z.boolean().optional(),
});

export class UpdateTaskDto extends createZodDto(UpdateTaskSchema) {}

const ReorderTasksSchema = z.object({
  orderedIds: z.string().uuid().array().max(1000),
});

export class ReorderTasksDto extends createZodDto(ReorderTasksSchema) {}
