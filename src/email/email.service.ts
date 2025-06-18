import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class EmailService {
  constructor(private mailerService: MailerService) {}

  async sendPasswordResetEmail(to: string, token: string) {
    const resetUrl = `${process.env.CLIENT_ORIGIN}/reset-password?token=${token}`;

    return this.mailerService.sendMail({
      to,
      subject: 'Reset your password',
      template: 'auth/reset-password',
      context: {
        resetUrl,
      },
    });
  }
}
