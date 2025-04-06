import {
  HttpStatus,
  HttpException,
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import * as bcrypt from 'bcrypt';

import { LoginDto, RegisterDto } from 'src/auth/schema';

import { UsersService } from 'src/users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async login(
    loginDto: LoginDto,
    response: Response,
  ): Promise<{ accessToken: string }> {
    const user = await this.usersService.findUnique({ email: loginDto.email });

    if (!user)
      throw new NotFoundException(
        'It seems you don’t have an account with us. Please register to get started.',
      );

    const passMatch = await bcrypt.compare(loginDto.password, user.password);

    if (!passMatch)
      throw new UnauthorizedException(
        'Invalid email or password. Please check your credentials.',
      );

    const payload = { id: user.id };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: process.env.ACCESS_TOKEN_SECRET,
      expiresIn: '15m',
    });
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: process.env.REFRESH_TOKEN_SECRET,
      expiresIn: '7d',
    });

    response.cookie('jwt', refreshToken, {
      httpOnly: true,
      secure: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'none',
    });

    return { accessToken };
  }

  async refresh(refreshToken: string) {
    try {
      const res = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env.REFRESH_TOKEN_SECRET,
      });
      const payload = { id: res.id };
      const accessToken = await this.jwtService.signAsync(payload, {
        secret: process.env.ACCESS_TOKEN_SECRET,
        expiresIn: '15m',
      });
      return { accessToken };
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

  async register({ email, name, password }: RegisterDto, response: Response) {
    try {
      const user = await this.usersService.create({ email, name, password });

      const payload = { id: user.id };
      const accessToken = await this.jwtService.signAsync(payload, {
        secret: process.env.ACCESS_TOKEN_SECRET,
        expiresIn: '15m',
      });
      const refreshToken = await this.jwtService.signAsync(payload, {
        secret: process.env.REFRESH_TOKEN_SECRET,
        expiresIn: '7d',
      });

      response.cookie('jwt', refreshToken, {
        httpOnly: true,
        secure: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'none',
      });

      return { accessToken };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ForbiddenException(
            'This email is already registered to an account.',
          );
        }
      }

      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error: error.message,
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }
  }

  async logout(refreshToken: string, response: Response) {
    if (!refreshToken)
      throw new HttpException(
        { status: HttpStatus.NO_CONTENT },
        HttpStatus.NO_CONTENT,
      );

    response.clearCookie('jwt');

    return { message: 'Cookie cleared' };
  }

  async getProfile(id: string) {
    const user = await this.usersService.findUnique({ id });

    return user;
  }
}
