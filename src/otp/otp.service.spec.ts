import { Prisma } from '@prisma/client';

import { OtpService } from './otp.service';

describe('OtpService', () => {
  const user = { id: 'u1', email: 'a@test.dev' } as any;

  const duplicate = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

  const setup = ({ replaced = 0, createError = undefined as unknown } = {}) => {
    const prisma = {
      emailVerificationOtp: {
        updateMany: jest.fn().mockResolvedValue({ count: replaced }),
        create: createError
          ? jest.fn().mockRejectedValue(createError)
          : jest.fn().mockResolvedValue({}),
      },
    };
    const email = { sendEmail: jest.fn().mockResolvedValue({}) };
    const service = new OtpService(prisma as any, email as any, {} as any);

    return { service, prisma, email };
  };

  it('stays silent during the cooldown and sends nothing', async () => {
    const { service, email } = setup({ createError: duplicate() });

    await expect(service.sendOtp(user)).resolves.toBeUndefined();

    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('only replaces a code older than the cooldown', async () => {
    const { service, prisma, email } = setup({ replaced: 1 });

    await service.sendOtp(user);

    const { where } = prisma.emailVerificationOtp.updateMany.mock.calls[0][0];
    expect(Date.now() - where.updatedAt.lt.getTime()).toBeGreaterThanOrEqual(
      60 * 1000,
    );
    expect(prisma.emailVerificationOtp.create).not.toHaveBeenCalled();
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('sends a first code', async () => {
    const { service, prisma, email } = setup();

    await service.sendOtp(user);

    expect(prisma.emailVerificationOtp.create).toHaveBeenCalledTimes(1);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("doesn't hide a real database failure", async () => {
    const { service, email } = setup({ createError: new Error('down') });

    await expect(service.sendOtp(user)).rejects.toThrow('down');

    expect(email.sendEmail).not.toHaveBeenCalled();
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
