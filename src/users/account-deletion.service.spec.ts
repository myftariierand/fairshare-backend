import { AccountDeletionService } from './account-deletion.service';

jest.mock('src/activity-logs/activity.service', () => ({
  ActivityLogsService: class {},
}));
jest.mock('src/cloudinary/cloudinary.service', () => ({
  CloudinaryService: class {},
}));
jest.mock('src/group-debt/groupDebt.service', () => ({
  GroupDebtService: class {},
}));
jest.mock('src/database/database.service', () => ({
  DatabaseService: class {},
}));

describe('AccountDeletionService snapshot scrubbing', () => {
  const service = new AccountDeletionService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  ) as any;

  const al = {
    id: 'al',
    name: 'Al Smith',
    email: 'al@test.dev',
    password: 'hash',
    role: 'USER',
  };
  const bob = { id: 'bob', name: 'Bob', email: 'bob@test.dev' };

  it('removes the person wherever they appear', () => {
    const scrubbed = service.scrub(
      {
        group: {
          name: 'Trip',
          createdBy: al,
          members: [
            { userId: 'al', user: al },
            { userId: 'bob', user: bob },
          ],
        },
        transaction: { paidBy: al },
      },
      'al',
    );
    const text = JSON.stringify(scrubbed);

    expect(text).not.toContain('Al Smith');
    expect(text).not.toContain('al@test.dev');
    expect(text).not.toContain('hash');
    expect(scrubbed.group.createdBy.name).toBe('Deleted user');
  });

  it('leaves everyone and everything else as it was', () => {
    const snapshot = {
      group: { name: 'Trip', total: 10, cover: null, members: [{ user: bob }] },
    };

    expect(service.scrub(snapshot, 'al')).toEqual(snapshot);
  });

  it('keeps the id, so the log still points at the same row', () => {
    expect(service.scrub(al, 'al').id).toBe('al');
  });

  it("doesn't add fields a snapshot didn't have", () => {
    expect(service.scrub({ id: 'al' }, 'al')).toEqual({ id: 'al' });
  });
});
