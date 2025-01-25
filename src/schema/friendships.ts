import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const SendFriendRequestParamsSchema = z.object({
  receiverId: z.string().uuid(),
});

export class SendFriendRequestParamsDto extends createZodDto(
  SendFriendRequestParamsSchema,
) {}

const AcceptFriendRequestParamsSchema = z.object({
  id: z.string().uuid(),
});

export class AcceptFriendRequestParamsDto extends createZodDto(
  AcceptFriendRequestParamsSchema,
) {}

const RejectFriendRequestParamsSchema = z.object({
  id: z.string().uuid(),
});

export class RejectFriendRequestParamsDto extends createZodDto(
  RejectFriendRequestParamsSchema,
) {}

const CancelFriendRequestParamsSchema = z.object({
  id: z.string().uuid(),
});

export class CancelFriendRequestParamsDto extends createZodDto(
  CancelFriendRequestParamsSchema,
) {}
