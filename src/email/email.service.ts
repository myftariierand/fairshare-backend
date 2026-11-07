import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private resend: Resend;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  async sendEmail({
    to,
    subject,
    html,
    text,
  }: {
    to: string | string[];
    subject: string;
    html: string;
    text: string;
  }) {
    const { data, error } = await this.resend.emails.send({
      from: 'FairShare <no-reply@fairshare.email>',
      to,
      subject,
      html,
      text,
    });

    if (error) {
      throw new Error(`Failed to send email: ${error.message}`);
    }

    return data;
  }
}
