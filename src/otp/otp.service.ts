import * as crypto from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { generateOtp } from 'src/auth/otp.util';

import { DatabaseService } from 'src/database/database.service';
import { EmailService } from 'src/email/email.service';
import { ActivityLogsService } from 'src/activity-logs/activity.service';
import { User } from '@prisma/client';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly MAX_ATTEMPTS = 5;
  private readonly RESEND_COOLDOWN_MS = 60 * 1000; // 60s between resends

  constructor(
    private prisma: DatabaseService,
    private emailService: EmailService,
    private activityLogsService: ActivityLogsService,
  ) {}

  async sendOtp(user: User): Promise<void> {
    const existing = await this.prisma.emailVerificationOtp.findUnique({
      where: { userId: user.id },
    });

    if (existing) {
      const sinceLastSent = Date.now() - existing.updatedAt.getTime();
      if (sinceLastSent < this.RESEND_COOLDOWN_MS) {
        throw new BadRequestException(
          'Please wait before requesting another code.',
        );
      }
    }

    const { otp, hashedOtp, expiresAt } = generateOtp();

    await this.prisma.emailVerificationOtp.upsert({
      where: { userId: user.id },
      create: { userId: user.id, otpHash: hashedOtp, expiresAt },
      update: { otpHash: hashedOtp, expiresAt, attempts: 0 },
    });

    await this.emailService.sendEmail({
      to: user.email,
      subject: 'Your OTP Code',
      html: `Your OTP code is: ${otp}`,
    });
  }

  async verifyOtp(user: User, otp: string): Promise<boolean> {
    const record = await this.prisma.emailVerificationOtp.findUnique({
      where: { userId: user.id },
    });

    if (!record) return false;
    if (record.expiresAt < new Date()) return false;

    if (record.attempts >= this.MAX_ATTEMPTS) {
      throw new ForbiddenException(
        'Too many attempts. Please request a new code.',
      );
    }

    const hashedInput = crypto.createHash('sha256').update(otp).digest('hex');

    if (hashedInput !== record.otpHash) {
      await this.prisma.emailVerificationOtp.update({
        where: { userId: user.id },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }

    await this.prisma.emailVerificationOtp.delete({
      where: { userId: user.id },
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
    await this.activityLogsService.createActivityLog({
      user: { connect: { id: user.id } },
      action: 'USER_EMAIL_VERIFIED',
    });

    return true;
  }
}
