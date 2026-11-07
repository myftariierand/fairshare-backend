import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

import { NewPasswordSchema } from 'src/auth/schema';

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  provider: z.string(),
  emailVerified: z.boolean(),
});

export class UserDto extends createZodDto(UserSchema) {}

const SearchUsersQuerySchema = z.object({
  query: z.string().max(100),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  groupId: z.string().uuid().optional(),
});

export class SearchUsersQueryDto extends createZodDto(SearchUsersQuerySchema) {}

const AdminUpdateUserSchema = z.object({ password: NewPasswordSchema });

export class AdminUpdateUserDto extends createZodDto(AdminUpdateUserSchema) {}
