import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

import { CurrencySchema, NameSchema } from 'src/schema/common';

const CreateGroupSchema = z.object({
  name: NameSchema,
  currency: CurrencySchema,
  // User ids to invite. Multipart gives a single value as a string, several as an array
  invite: z
    .union([z.string().uuid(), z.string().uuid().array()])
    .optional()
    .transform((value) => (value === undefined ? [] : [value].flat())),
});

export class CreateGroupDto extends createZodDto(CreateGroupSchema) {}

const UpdateParamsSchema = z.object({ groupId: z.string().uuid() });

export class UpdateParamsDto extends createZodDto(UpdateParamsSchema) {}

const UpdateGroupSchema = z.object({
  name: NameSchema,
  currency: CurrencySchema,
  // Sent as text because the update request is multipart
  removeCover: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
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

const JoinGroupParamsSchema = z.object({
  token: z.string().uuid(),
});

export class JoinGroupParamsDto extends createZodDto(JoinGroupParamsSchema) {}

const InviteLinkParamsSchema = z.object({
  groupId: z.string().uuid(),
});

export class InviteLinkParamsDto extends createZodDto(InviteLinkParamsSchema) {}

const LeaveGroupParamsSchema = z.object({
  groupId: z.string().uuid(),
});

export class LeaveGroupParamsDto extends createZodDto(LeaveGroupParamsSchema) {}

const GroupMemberRemoveSchmea = z.object({
  groupId: z.string().uuid(),
  memberId: z.string().uuid(),
});

export class GroupMemberRemoveParamsDto extends createZodDto(
  GroupMemberRemoveSchmea,
) {}
