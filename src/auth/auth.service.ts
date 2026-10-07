import {
  HttpStatus,
  HttpException,
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role, User } from '@prisma/client';
import { Request, Response } from 'express';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';

import { LoginDto, RegisterDto } from 'src/auth/schema';

import { UsersService } from 'src/users/users.service';
import { DatabaseService } from 'src/database/database.service';
import { EmailService } from 'src/email/email.service';
import { ActivityLogsService } from 'src/activity-logs/activity.service';

import { renderTemplate } from 'templates/render-template';
import { OtpService } from 'src/otp/otp.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private googleClient = new OAuth2Client();

  private readonly REFRESH_TOKEN_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;
  private readonly REFRESH_TOKEN_EXPIRY = '365d';
  private readonly ACCESS_TOKEN_EXPIRY = '15m';

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: DatabaseService,
    private emailService: EmailService,
    private activityLogsService: ActivityLogsService,
    private otpService: OtpService,
  ) {}

  async login(
    loginDto: LoginDto,
    response: Response,
    request: Request<{ headers: { 'x-client': string } }>,
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    user?: Omit<User, 'password'>;
  }> {
    const user = await this.usersService.findUnique({ email: loginDto.email });

    if (!user)
      throw new NotFoundException(
        'It seems you don’t have an account with us. Please register to get started.',
      );

    const { password, ...rest } = user;

    const passMatch = await bcrypt.compare(loginDto.password, password);

    if (!passMatch)
      throw new UnauthorizedException(
        'Invalid email or password. Please check your credentials.',
      );

    const payload = { id: user.id };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: process.env.ACCESS_TOKEN_SECRET,
      expiresIn: this.ACCESS_TOKEN_EXPIRY,
    });
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: process.env.REFRESH_TOKEN_SECRET,
      expiresIn: this.REFRESH_TOKEN_EXPIRY,
    });

    if (request.headers['x-client'] === 'mobile')
      return { accessToken, refreshToken, user: rest };

    response.cookie('jwt', refreshToken, {
      httpOnly: true,
      secure: true,
      maxAge: this.REFRESH_TOKEN_EXPIRY_MS,
      sameSite: 'none',
    });

    return { accessToken };
  }

  async refresh(refreshToken: string) {
    try {
      const res = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env.REFRESH_TOKEN_SECRET,
      });

      const payload = { id: res.id, role: res.role };
      const accessToken = await this.jwtService.signAsync(payload, {
        secret: process.env.ACCESS_TOKEN_SECRET,
        expiresIn: this.ACCESS_TOKEN_EXPIRY,
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

  async register(
    { email, name, password }: RegisterDto,
    response: Response,
    request: Request<{ headers: { 'x-client': string } }>,
  ) {
    try {
      const user = await this.usersService.create({ email, name, password });

      await this.activityLogsService.createActivityLog({
        action: 'USER_REGISTERED',
        user: { connect: { id: user.id } },
      });

      try {
        await this.otpService.sendOtp(user);
      } catch (otpError) {
        this.logger.error(
          'Failed to send verification OTP after registration',
          otpError,
        );
      }

      const payload = { id: user.id };
      const accessToken = await this.jwtService.signAsync(payload, {
        secret: process.env.ACCESS_TOKEN_SECRET,
        expiresIn: this.ACCESS_TOKEN_EXPIRY,
      });
      const refreshToken = await this.jwtService.signAsync(payload, {
        secret: process.env.REFRESH_TOKEN_SECRET,
        expiresIn: this.REFRESH_TOKEN_EXPIRY,
      });

      if (request.headers['x-client'] === 'mobile')
        return { accessToken, refreshToken, user };

      response.cookie('jwt', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: this.REFRESH_TOKEN_EXPIRY_MS,
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
        this.logger.error('User registration validation error', error.message);
        throw new BadRequestException('Invalid registration data.');
      }

      // Unknown error — log and rethrow so it isn't silently swallowed
      this.logger.error('Unexpected error during registration', error);
      throw error;
    }
  }

  async logout(refreshToken: string, response: Response) {
    if (!refreshToken)
      throw new HttpException(
        { status: HttpStatus.NO_CONTENT },
        HttpStatus.NO_CONTENT,
      );

    response.clearCookie('jwt', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    });

    return { message: 'Cookie cleared' };
  }

  async getProfile(id: string) {
    console.log(id);

    const user = (await this.usersService.findUnique(
      { id },
      {
        include: {
          memberships: {
            where: {
              userId: id,
            },
            include: {
              group: {
                include: {
                  members: true,
                  transactions: {
                    include: {
                      splits: true,
                      group: {
                        select: {
                          currency: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },

          friendshipsReceiver: {
            include: {
              sender: true,
              receiver: true,
            },
          },

          friendshipsSender: {
            include: {
              sender: true,
              receiver: true,
            },
          },
        },
        omit: { password: true },
      },
    )) as Prisma.UserGetPayload<{
      include: {
        memberships: {
          include: {
            group: {
              include: {
                transactions: {
                  include: { group: { select: { currency: true } } };
                };
              };
            };
          };
        };
        friendshipsReceiver: { include: { sender: true; receiver: true } };
        friendshipsSender: { include: { sender: true; receiver: true } };
      };
    }>;

    if (!user) return null;

    const friends = [
      ...user.friendshipsReceiver.filter(
        (request) => request.status === 'ACCEPTED',
      ),
      ...user.friendshipsSender.filter(
        (request) => request.status === 'ACCEPTED',
      ),
    ].map((friendship) => {
      const friend =
        friendship.senderId === id ? friendship.receiver : friendship.sender;

      return {
        id: friend.id,
        name: friend.name,
        email: friend.email,
        requestId: friendship.id,
        createdAt: friend.createdAt,
        updatedAt: friend.updatedAt,
      };
    });

    const groups = user.memberships.map((membership) => membership.group);

    return { ...user, groups, friends };
  }

  async changePassword(
    userId: string,
    password: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    if (newPassword !== confirmPassword) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          message: 'New password and confirmation do not match',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.usersService.findUnique({ id: userId });

    if (!user) {
      throw new HttpException(
        {
          status: HttpStatus.NOT_FOUND,
          message: 'User not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const isGoogleUser = await bcrypt.compare('', user.password);

    if (!isGoogleUser) {
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        throw new HttpException(
          {
            status: HttpStatus.UNAUTHORIZED,
            message: 'Invalid password',
          },
          HttpStatus.UNAUTHORIZED,
        );
      }
    }

    const hashedPwd = await bcrypt.hash(newPassword, 10);

    const res = await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPwd },
    });

    await this.activityLogsService.createActivityLog({
      action: 'USER_CHANGED_PASSWORD',
      user: { connect: { id: userId } },
    });

    return res;
  }

  async updateProfile(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    const user = await this.prisma.user.update({ where: { id }, data });

    await this.activityLogsService.createActivityLog({
      action: 'USER_UPDATED_PROFILE',
      user: { connect: { id } },
    });

    return user;
  }

  async googleLogin(user: User, res: Response) {
    if (!user) {
      return res.status(401).json({ message: 'Google authentication failed.' });
    }

    const payload = { id: user.id };
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: process.env.REFRESH_TOKEN_SECRET,
      expiresIn: this.REFRESH_TOKEN_EXPIRY,
    });

    res.cookie('jwt', refreshToken, {
      httpOnly: true,
      secure: true,
      maxAge: this.REFRESH_TOKEN_EXPIRY_MS,
      sameSite: 'none',
    });

    return res.redirect(process.env.CLIENT_ORIGIN || '/');
  }

  async forgotPassword(email: string) {
    const user = await this.usersService.findUnique({
      email: email.trim().toLowerCase(),
    });

    if (user) {
      const resetToken = await this.jwtService.signAsync(
        { id: user.id },
        {
          secret: process.env.RESET_PASSWORD_SECRET,
          expiresIn: '1h',
        },
      );

      const resetUrl = `${process.env.CLIENT_ORIGIN}/reset-password?token=${resetToken}`;

      const html = renderTemplate('reset-password', { resetUrl });

      await this.emailService.sendEmail({
        to: user.email,
        subject: `FairShare Password Reset`,
        html,
      });
    }

    return {
      message: 'If the account exists, a reset email has been sent.',
    };
  }

  async resetPassword(
    token: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    if (newPassword !== confirmPassword) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          message: 'New password and confirmation do not match',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const decoded = await this.jwtService.verifyAsync(token, {
        secret: process.env.RESET_PASSWORD_SECRET,
      });

      const user = await this.usersService.findUnique({ id: decoded.id });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const hashedPwd = await bcrypt.hash(newPassword, 10);

      await this.prisma.user.update({
        where: { id: decoded.id },
        data: { password: hashedPwd },
      });

      return { message: 'Password reset successfully' };
    } catch (error: any) {
      throw new ForbiddenException('Invalid or expired token');
    }
  }

  async verifyResetToken(token: string) {
    try {
      await this.jwtService.verifyAsync(token, {
        secret: process.env.RESET_PASSWORD_SECRET,
      });

      return { valid: true };
    } catch (error: any) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async loginAdmin(loginDto: LoginDto, response: Response) {
    const user = await this.usersService.findUnique({ email: loginDto.email });

    // Generic message on purpose — don't leak whether the email exists or
    // whether it exists-but-isn't-an-admin. Both are useful signal to an attacker.
    const invalidCreds = () =>
      new UnauthorizedException('Invalid email or password.');

    if (!user) throw invalidCreds();

    const passMatch = await bcrypt.compare(loginDto.password, user.password);
    if (!passMatch) throw invalidCreds();

    if (user.role !== Role.ADMIN) {
      // Log this — repeated hits are a signal someone's probing for admin access.
      this.logger.warn(`Non-admin login attempt on admin endpoint: ${user.id}`);
      throw invalidCreds();
    }

    const payload = { id: user.id, role: user.role };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: process.env.ACCESS_TOKEN_SECRET,
      expiresIn: this.ACCESS_TOKEN_EXPIRY,
    });
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: process.env.REFRESH_TOKEN_SECRET,
      expiresIn: this.REFRESH_TOKEN_EXPIRY,
    });

    response.cookie('jwt', refreshToken, {
      httpOnly: true,
      secure: true,
      maxAge: this.REFRESH_TOKEN_EXPIRY_MS,
      sameSite: 'none',
    });

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async me(userId: string) {
    const user = await this.usersService.findUnique({ id: userId });
    if (!user) throw new NotFoundException('User not found');
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }

  async loginWithGoogleIdToken(idToken: string) {
    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_WEB_CLIENT_ID!,
    });

    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified) {
      throw new UnauthorizedException('Google account not verified');
    }

    let user = await this.usersService.findUnique({ email: payload.email });

    if (!user) {
      user = await this.usersService.create({
        name: payload.name ?? payload.given_name ?? payload.email.split('@')[0],
        email: payload.email,
        password: '', // Not used for OAuth users
        provider: 'google',
        emailVerified: true,
      });
    }

    const accessToken = await this.jwtService.signAsync(
      { id: user.id },
      {
        secret: process.env.ACCESS_TOKEN_SECRET,
        expiresIn: this.ACCESS_TOKEN_EXPIRY,
      },
    );
    const refreshToken = await this.jwtService.signAsync(
      { id: user.id },
      {
        secret: process.env.REFRESH_TOKEN_SECRET,
        expiresIn: this.REFRESH_TOKEN_EXPIRY,
      },
    );

    return { accessToken, refreshToken };
  }
}
