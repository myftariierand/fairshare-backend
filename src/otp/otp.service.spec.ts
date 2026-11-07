import { OtpService } from './otp.service';

describe('OtpService', () => {
  const user = { id: 'u1', email: 'a@test.dev' } as any;

  const setup = (existing?: { updatedAt: Date }) => {
    const prisma = {
      emailVerificationOtp: {
        findUnique: jest.fn().mockResolvedValue(existing ?? null),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const email = { sendEmail: jest.fn().mockResolvedValue({}) };
    const service = new OtpService(prisma as any, email as any, {} as any);

    return { service, prisma, email };
  };

  it('stays silent during the cooldown and sends nothing', async () => {
    const { service, email } = setup({ updatedAt: new Date() });

    await expect(service.sendOtp(user)).resolves.toBeUndefined();

    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('sends a new code once the cooldown has passed', async () => {
    const { service, email } = setup({
      updatedAt: new Date(Date.now() - 61 * 1000),
    });

    await service.sendOtp(user);

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('survives an email failure when sending in the background', async () => {
    const { service, email } = setup();
    const logged = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation();
    email.sendEmail.mockRejectedValue(new Error('provider down'));

    expect(() => service.sendOtpInBackground(user)).not.toThrow();
    await new Promise(setImmediate);

    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('treats too many attempts like a wrong code', async () => {
    const { service } = setup();

    await expect(service.verifyOtp(user, '123456')).resolves.toBe(false);
  });
});
