import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export class UserDto extends createZodDto(UserSchema) {}

const SearchUsersQuerySchema = z.object({
  query: z.string(),
  limit: z.number().optional().default(10),
  offset: z.number().optional().default(0),
});

export class SearchUsersQueryDto extends createZodDto(SearchUsersQuerySchema) {}
