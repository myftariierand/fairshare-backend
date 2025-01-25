import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const CreateGroupSchema = z.object({
  name: z.string(),
});

export class CreateGroupDto extends createZodDto(CreateGroupSchema) {}

const UpdateParamsSchema = z.object({ groupId: z.string().uuid() });

export class UpdateParamsDto extends createZodDto(UpdateParamsSchema) {}

const UpdateGroupSchema = z.object({
  name: z.string(),
});

export class UpdateGroupDto extends createZodDto(UpdateGroupSchema) {}

const DeleteGroupParamsSchema = z.object({
  groupId: z.string().uuid(),
});

export class DeleteGroupParamsDto extends createZodDto(
  DeleteGroupParamsSchema,
) {}

const InvitationsQuerySchema = z.object({
  status: z.enum(['ACCEPTED', 'REJECTED', 'PENDING']),
});

export class InvitationsQueryDto extends createZodDto(InvitationsQuerySchema) {}

const GroupInviteParamsSchema = z.object({
  groupId: z.string().uuid(),
  receiverId: z.string().uuid(),
});

export class GroupInviteParamsDto extends createZodDto(
  GroupInviteParamsSchema,
) {}

const AcceptGroupParamsSchema = z.object({
  groupId: z.string().uuid(),
  inviteId: z.string().uuid(),
});

export class AcceptGroupInviteParamsDto extends createZodDto(
  AcceptGroupParamsSchema,
) {}

const RejectGroupParamsSchema = z.object({
  inviteId: z.string().uuid(),
});

export class RejectGroupInviteParamsDto extends createZodDto(
  RejectGroupParamsSchema,
) {}
