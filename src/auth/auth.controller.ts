import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Response } from 'express';

import { AuthService } from 'src/auth/auth.service';
import { Cookies, Public } from 'src/auth/auth.decorators';

import { LoginDto, RegisterDto } from 'src/auth/schema';
import { UserDto } from 'src/schema/user';
import { ZodSerializerDto } from 'nestjs-zod';
import { User } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.login(loginDto, response);
  }

  @Public()
  @Get('refresh')
  refresh(@Cookies('jwt') refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }

  @Public()
  @Post('register')
  register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.register(registerDto, response);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(
    @Cookies('jwt') refreshToken: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.logout(refreshToken, response);
  }

  @Get('profile')
  @ZodSerializerDto(UserDto)
  getProfile(@Req() req) {
    return this.authService.getProfile(req.id);
  }

  @Post('change-password')
  async changePassword(
    @Req() req,
    @Body()
    {
      password,
      newPassword,
      confirmPassword,
    }: { password: string; newPassword: string; confirmPassword: string },
  ): Promise<User> {
    return this.authService.changePassword(
      req.id,
      password,
      newPassword,
      confirmPassword,
    );
  }

  @Public()
  @Post('forgot-password')
  async forgotPassword(@Body('email') email: string) {
    return this.authService.forgotPassword(email);
  }

  @Public()
  @Post('reset-password')
  async resetPassword(
    @Body('token') token: string,
    @Body('password') password: string,
    @Body('confirmPassword') confirmPassword: string,
  ) {
    return this.authService.resetPassword(token, password, confirmPassword);
  }
}
