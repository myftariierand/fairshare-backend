import { Controller, Get, Query } from '@nestjs/common';

import { UsersService } from 'src/users/users.service';
import { UserId } from 'src/users/user.decorator';

import { SearchUsersQueryDto } from 'src/schema/user';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('search')
  async searchUsers(
    @UserId() userId,
    @Query() { query, limit, offset, groupId }: SearchUsersQueryDto,
  ) {
    return this.usersService.searchUsers(userId, query, limit, offset, groupId);
  }
}
