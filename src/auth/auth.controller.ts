import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';

import { AuthService } from 'src/auth/auth.service';
import { Cookies, Public } from 'src/auth/auth.decorators';

import {
  ChangePasswordDto,
  ForgotPasswordDto,
  GoogleMobileLoginDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyOtpDtoClass,
  VerifyResetTokenQueryDto,
  RequestOtpDtoClass,
} from 'src/auth/schema';
import { User } from '@prisma/client';
import { UserId } from 'src/users/user.decorator';
import { OtpService } from 'src/otp/otp.service';
import { UsersService } from 'src/users/users.service';
import { MINUTE, ThrottleByClient, ThrottleByEmail } from 'src/throttling';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private otpService: OtpService,
    private usersService: UsersService,
  ) {}

  @Public()
  @ThrottleByClient(10)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request<{ headers: { 'x-client': string } }>,
  ) {
    return this.authService.login(loginDto, response, request);
  }

  @Public()
  @ThrottleByClient(120)
  @Get('refresh')
  refresh(
    @Cookies('jwt') refreshToken: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.refreshWithCookie(refreshToken, response);
  }

  @Public()
  @ThrottleByClient(120)
  @Post('refresh')
  refreshMobile(@Body('refreshToken') refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }

  @Public()
  @ThrottleByClient(10)
  @Post('register')
  register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request<{ headers: { 'x-client': string } }>,
  ) {
    return this.authService.register(registerDto, response, request);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(
    @Cookies('jwt') cookieToken: string,
    @Body('refreshToken') bodyToken: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.logout(cookieToken ?? bodyToken, response);
  }

  @Get('profile')
  getProfile(@Req() req) {
    return this.authService.getProfile(req.id);
  }

  @ThrottleByClient(10)
  @Post('change-password')
  async changePassword(
    @Req() req,
    @Cookies('jwt') cookieToken: string,
    @Body()
    { password, newPassword, confirmPassword, refreshToken }: ChangePasswordDto,
  ): Promise<User> {
    return this.authService.changePassword(
      req.id,
      password,
      newPassword,
      confirmPassword,
      cookieToken ?? refreshToken,
    );
  }

  @Public()
  @ThrottleByClient(5)
  @ThrottleByEmail(3)
  @Post('forgot-password')
  async forgotPassword(@Body() { email }: ForgotPasswordDto) {
    return this.authService.forgotPassword(email);
  }

  @Public()
  @ThrottleByClient(10)
  @Post('reset-password')
  async resetPassword(
    @Body() { token, password, confirmPassword }: ResetPasswordDto,
  ) {
    return this.authService.resetPassword(token, password, confirmPassword);
  }

  @Public()
  @ThrottleByClient(20)
  @Get('verify-reset-token')
  async verifyResetToken(@Query() { token }: VerifyResetTokenQueryDto) {
    return this.authService.verifyResetToken(token);
  }

  @Post('update-profile')
  async updateProfile(
    @UserId() userId,
    @Body() body: UpdateProfileDto,
  ): Promise<User> {
    return this.authService.updateProfile(userId, body);
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @Public()
  async googleAuth() {
    // Guard redirects to Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @Public()
  async googleAuthCallback(@Req() req, @Res() res: Response) {
    await this.authService.googleLogin(req.user, res);
  }

  @Public()
  @ThrottleByClient(20)
  @Post('google/mobile')
  async googleMobile(@Body() dto: GoogleMobileLoginDto) {
    return this.authService.loginWithGoogleIdToken(dto.idToken);
  }

  @Public()
  @ThrottleByClient(5)
  @ThrottleByEmail(5)
  @Post('verify-email/send')
  async sendVerificationEmail(@Body() body: RequestOtpDtoClass) {
    const user = await this.usersService.findUnique({
      email: body.email,
    });

    if (user) {
      this.otpService.sendOtpInBackground(user);
    }
    return { message: 'If that email is registered, a code has been sent.' };
  }

  @Public()
  @ThrottleByClient(20)
  @ThrottleByEmail(10, 15 * MINUTE)
  @Post('verify-email/verify')
  async verifyEmailOtp(
    @Body() body: VerifyOtpDtoClass,
  ): Promise<{ verified: boolean }> {
    const user = await this.usersService.findUnique({ email: body.email });

    if (!user) {
      return { verified: false };
    }

    const isValid = await this.otpService.verifyOtp(user, body.otp);

    return { verified: isValid };
  }

  @Public()
  @ThrottleByClient(5)
  @Post('admin/login')
  async adminLogin(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.loginAdmin(loginDto, response);
  }
}
