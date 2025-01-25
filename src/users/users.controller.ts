import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
  UnauthorizedException,
} from '@nestjs/common';

import { User } from '@prisma/client';

import { UsersService } from 'src/users/users.service';
import { UserId } from 'src/users/user.decorator';

import { SearchUsersQueryDto } from 'src/schema/user';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  async getUsers() {
    return this.usersService.findMany();
  }

  @Get('search')
  async searchUsers(
    @UserId() userId,
    @Query() { query, limit, offset }: SearchUsersQueryDto,
  ) {
    return this.usersService.searchUsers(userId, query, limit, offset);
  }

  @Get(':id')
  async getUserById(@Param('id') id: string): Promise<User> {
    try {
      const user = await this.usersService.findUnique({ id });

      if (!user) throw new UnauthorizedException();

      return user;
    } catch (error: any) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          message: `Forbidden: ${error.message}`,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
