import { validateEnv } from './env.validation';

const valid = {
  DATABASE_URL: 'postgresql://user:db-password-value@localhost/db',
  ACCESS_TOKEN_SECRET: 'a'.repeat(64),
  RESET_PASSWORD_SECRET: 'b'.repeat(64),
  CLIENT_ORIGIN: 'http://localhost:5173',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'google-secret-value',
  GOOGLE_CALLBACK_URL: 'http://localhost/cb',
  RESEND_API_KEY: 're_key',
  CLOUDINARY_CLOUD_NAME: 'cloud',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
};

describe('validateEnv', () => {
  it('accepts a complete configuration', () => {
    expect(validateEnv(valid)).toBe(valid);
  });

  it('keeps variables it does not check', () => {
    const config = { ...valid, PORT: '3000', ANYTHING_ELSE: 'x' };

    expect(validateEnv(config)).toBe(config);
  });

  it('does not require the optional variables', () => {
    expect(() =>
      validateEnv({
        ...valid,
        PORT: undefined,
        ADMIN_ORIGIN: undefined,
        MOBILE_ORIGIN: undefined,
        GOOGLE_WEB_CLIENT_ID: undefined,
      }),
    ).not.toThrow();
  });

  it.each(Object.keys(valid))('refuses to start without %s', (name) => {
    const config: Record<string, unknown> = { ...valid };
    delete config[name];

    expect(() => validateEnv(config)).toThrow(`${name} is missing or empty`);
  });

  it('treats an empty value as missing', () => {
    expect(() => validateEnv({ ...valid, GOOGLE_CLIENT_ID: '' })).toThrow(
      'GOOGLE_CLIENT_ID is missing or empty',
    );
  });

  it('refuses short signing secrets', () => {
    expect(() =>
      validateEnv({ ...valid, ACCESS_TOKEN_SECRET: 'short' }),
    ).toThrow('ACCESS_TOKEN_SECRET must be at least 32 characters');
  });

  it('lists every problem at once', () => {
    const { DATABASE_URL, RESEND_API_KEY, ...rest } = valid;

    expect(() => validateEnv(rest)).toThrow(
      /DATABASE_URL[\s\S]*RESEND_API_KEY/,
    );
    expect(DATABASE_URL && RESEND_API_KEY).toBeTruthy();
  });

  it('never puts values in the error', () => {
    let message = '';

    try {
      validateEnv({ ...valid, ACCESS_TOKEN_SECRET: 'short-secret-value' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('ACCESS_TOKEN_SECRET');
    expect(message).not.toContain('short-secret-value');
    expect(message).not.toContain('db-password-value');
    expect(message).not.toContain('google-secret-value');
  });
});
