import * as crypto from 'crypto';

// Keyed, because with only a million possible codes anyone reading the table could otherwise try
// them all at once
export const hashOtp = (otp: string) =>
  crypto
    .createHmac('sha256', process.env.RESET_PASSWORD_SECRET as string)
    .update(otp)
    .digest('hex');

export const OTP_EXPIRY_MINUTES = 5;

export const generateOtp = (): {
  otp: string;
  hashedOtp: string;
  expiresAt: Date;
} => {
  const otp = crypto.randomInt(100000, 1000000).toString();
  const hashedOtp = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  return { otp, hashedOtp, expiresAt };
};
