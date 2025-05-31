import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export class LoginDto extends createZodDto(LoginSchema) {}

export const RegisterSchema = z
  .object({
    name: z.string(),
    email: z.string().email(),
    password: z.string().min(1, 'This field is required!'),
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
