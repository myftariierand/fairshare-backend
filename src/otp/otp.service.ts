import { Injectable, Logger } from '@nestjs/common';
import { generateOtp, hashOtp } from 'src/auth/otp.util';

import { DatabaseService } from 'src/database/database.service';
import { EmailService } from 'src/email/email.service';
import { ActivityLogsService } from 'src/activity-logs/activity.service';
import { Prisma, User } from '@prisma/client';

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

  // For public endpoints. Not awaited: waiting for the email, or failing with it, would give away
  // that the account exists.
  sendOtpInBackground(user: User): void {
    this.sendOtp(user).catch((error) => {
      this.logger.error('Failed to send verification OTP', error);
    });
  }

  async sendOtp(user: User): Promise<void> {
    const { otp, hashedOtp, expiresAt } = generateOtp();

    // Replaced only if the last one is old enough, in one statement, so requests at the same moment
    // can't all see that it's fine to send
    const { count } = await this.prisma.emailVerificationOtp.updateMany({
      where: {
        userId: user.id,
        updatedAt: { lt: new Date(Date.now() - this.RESEND_COOLDOWN_MS) },
      },
      data: { otpHash: hashedOtp, expiresAt, attempts: 0 },
    });

    if (!count) {
      try {
        await this.prisma.emailVerificationOtp.create({
          data: { userId: user.id, otpHash: hashedOtp, expiresAt },
        });
      } catch (error) {
        // One already exists, so this is inside the cooldown. Silent, because an error here would
        // only ever appear for an email that has an account.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return;
        }

        throw error;
      }
    }

    await this.emailService.sendEmail({
      to: user.email,
      subject: 'Your OTP Code',
      html: `Your OTP code is: ${otp}`,
    });
  }

  async verifyOtp(user: User, otp: string): Promise<boolean> {
    const now = new Date();

    // The attempt is counted before the code is checked, in one statement, so guesses sent at the
    // same time can't all see the same count and get past the limit
    const { count } = await this.prisma.emailVerificationOtp.updateMany({
      where: {
        userId: user.id,
        expiresAt: { gte: now },
        attempts: { lt: this.MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });

    // Too many attempts looks like a wrong code, because a distinct error would only ever appear
    // for an email that has an account
    if (!count) return false;

    const hashedInput = hashOtp(otp);

    return this.prisma.$transaction(async (tx) => {
      // The code is used up here, so the same code sent twice only counts once
      const { count: matched } = await tx.emailVerificationOtp.deleteMany({
        where: { userId: user.id, otpHash: hashedInput },
      });

      if (!matched) return false;

      await tx.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
      await this.activityLogsService.createActivityLog(
        {
          user: { connect: { id: user.id } },
          action: 'USER_EMAIL_VERIFIED',
        },
        tx,
      );

      return true;
    });
  }
}
