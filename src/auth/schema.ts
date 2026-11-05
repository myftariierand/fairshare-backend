import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// bcrypt treats a lone NUL byte the same as an empty string, so both must be rejected
const hasNoNulByte = (value: string) => !value.includes('\0');

// For logging in: existing passwords may be shorter than today's rules allow
export const PasswordSchema = z
  .string()
  .min(1, 'This field is required!')
  .refine(hasNoNulByte, 'Invalid password');

// For setting a password. bcrypt ignores everything after 72 bytes, so a longer password would
// silently be weaker than it looks.
export const NewPasswordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .refine(
    (value) => Buffer.byteLength(value) <= 72,
    'Use at most 72 characters',
  )
  .refine(hasNoNulByte, 'Invalid password');

export const LoginSchema = z.object({
  email: z.string().email(),
  password: PasswordSchema,
});

export class LoginDto extends createZodDto(LoginSchema) {}

export const RegisterSchema = z
  .object({
    name: z.string(),
    email: z.string().email(),
    password: NewPasswordSchema,
    confirmPassword: z.string().min(1, 'This field is required!'),
  })
  .superRefine((args, ctx) => {
    if (args.password !== args.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        message: 'The passwords did not match',
        path: ['confirmPassword'],
      });
    }
  });

export class RegisterDto extends createZodDto(RegisterSchema) {}

const UpdateProfileSchema = z.object({ name: z.string() });

export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}

const ChangePasswordSchema = z.object({
  // Accounts created through Google have no current password to send
  password: z.string().optional(),
  newPassword: NewPasswordSchema,
  confirmPassword: z.string(),
  // Sent by the mobile app, which has no cookie, to stay logged in after the change
  refreshToken: z.string().optional(),
});

export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}

const ResetPasswordSchema = z.object({
  token: z.string(),
  password: NewPasswordSchema,
  confirmPassword: z.string(),
});

export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}

const ForgotPasswordSchema = z.object({ email: z.string().email() });

export class ForgotPasswordDto extends createZodDto(ForgotPasswordSchema) {}

const GoogleMobileLoginSchema = z.object({ idToken: z.string().min(1) });

export class GoogleMobileLoginDto extends createZodDto(
  GoogleMobileLoginSchema,
) {}

export const RequestOtpDto = z.object({
  email: z.string().email(),
});

export class RequestOtpDtoClass extends createZodDto(RequestOtpDto) {}

export const VerifyOtpDto = z.object({
  email: z.string().email(),
  otp: z.string(),
});

export class VerifyOtpDtoClass extends createZodDto(VerifyOtpDto) {}
