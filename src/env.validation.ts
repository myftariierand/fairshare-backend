import { z } from 'zod';

const required = z.string().min(1, 'is missing or empty');

const secret = required.min(32, 'must be at least 32 characters');

// Optional ones aren't listed: NOTIFICATION_EMAIL just turns off owner emails when unset, SUPPORT_EMAIL only adds a contact line, DONATION_URL only adds a section to the welcome email, PORT has a default, ADMIN_ORIGIN and MOBILE_ORIGIN only add to CORS,
// and GOOGLE_WEB_CLIENT_ID is for a mobile app using a different Google client from the backend
const EnvSchema = z.object({
  DATABASE_URL: required,
  ACCESS_TOKEN_SECRET: secret,
  RESET_PASSWORD_SECRET: secret,
  CLIENT_ORIGIN: required,
  GOOGLE_CLIENT_ID: required,
  GOOGLE_CLIENT_SECRET: required,
  GOOGLE_CALLBACK_URL: required,
  RESEND_API_KEY: required,
  CLOUDINARY_CLOUD_NAME: required,
  CLOUDINARY_API_KEY: required,
  CLOUDINARY_API_SECRET: required,
});

// Better not to start than to run with a security check quietly switched off. The error names
// the variables but never includes their values, since it ends up in logs.
export const validateEnv = (config: Record<string, unknown>) => {
  const result = EnvSchema.safeParse(config);

  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) =>
        `${issue.path.join('.')} ${issue.code === 'invalid_type' ? 'is missing or empty' : issue.message}`,
    );

    throw new Error(
      `Invalid environment variables:\n  ${problems.join('\n  ')}`,
    );
  }

  return config;
};
