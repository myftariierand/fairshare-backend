import * as crypto from 'crypto';

export const generateOtp = (): {
  otp: string;
  hashedOtp: string;
  expiresAt: Date;
} => {
  const otp = crypto.randomInt(100000, 999999).toString();
  const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // OTP expires in 5 minutes

  return { otp, hashedOtp, expiresAt };
};
