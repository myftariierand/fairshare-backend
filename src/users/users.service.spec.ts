import { UsersService } from './users.service';

const existing = (overrides = {}) => ({
  id: 'user-1',
  name: 'Someone',
  email: 'owner@gmail.com',
  password: 'attacker-hash',
  provider: 'local',
  emailVerified: false,
  createdAt: new Date(),
  ...overrides,
});

describe('UsersService.findOrCreateGoogleUser', () => {
  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    refreshToken: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const email = { sendEmail: jest.fn().mockResolvedValue({}) };

  let service: UsersService;

  beforeEach(() => {
    jest.resetAllMocks();
    email.sendEmail.mockResolvedValue({});
    prisma.$transaction.mockImplementation((operations) =>
      Promise.all(operations),
    );
    prisma.user.create.mockImplementation(async ({ data }) => ({
      id: 'new',
      createdAt: new Date(),
      ...data,
    }));
    prisma.user.update.mockImplementation(async ({ data }) => ({
      ...existing(),
      ...data,
    }));
    service = new UsersService(prisma as never, email as never);
  });

  it('creates a verified account with no password for a new email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const user = await service.findOrCreateGoogleUser('new@gmail.com', 'New');

    expect(user).toMatchObject({
      email: 'new@gmail.com',
      password: null,
      provider: 'google',
      emailVerified: true,
    });
  });

  it('removes the password from an unverified account with this email', async () => {
    prisma.user.findUnique.mockResolvedValue(existing());

    const user = await service.findOrCreateGoogleUser(
      'owner@gmail.com',
      'Owner',
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { password: null, provider: 'google', emailVerified: true },
    });
    expect(user.password).toBeNull();
  });

  it('ends the sessions of the previous holder', async () => {
    prisma.user.findUnique.mockResolvedValue(existing());

    await service.findOrCreateGoogleUser('owner@gmail.com', 'Owner');

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  it('leaves a verified account and its password alone', async () => {
    const verified = existing({ password: 'own-hash', emailVerified: true });
    prisma.user.findUnique.mockResolvedValue(verified);

    const user = await service.findOrCreateGoogleUser(
      'owner@gmail.com',
      'Owner',
    );

    expect(user).toBe(verified);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('matches the email however it is capitalized', async () => {
    prisma.user.findUnique.mockResolvedValue(existing({ emailVerified: true }));

    await service.findOrCreateGoogleUser(' Owner@Gmail.com ', 'Owner');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'owner@gmail.com' },
    });
  });
});
