// End-to-end check of admin actions and account deletion. The real app, bcrypt and database;
// only email, and cover file removal, are replaced. Postgres is disposable.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('refusing to run outside the throwaway database');

const P = require('path').resolve(__dirname, '../..');
const R = `${P}/src`;
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import * as cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';

const { AppModule } = require(`${R}/app.module`);
const { DatabaseService } = require(`${R}/database/database.service`);
const { EmailService } = require(`${R}/email/email.service`);
const { CloudinaryService } = require(`${R}/cloudinary/cloudinary.service`);

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};
const PASSWORD = 'correct-password-1';

(async () => {
  const removedCovers: string[] = [];
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(require('@nestjs/throttler').ThrottlerStorage).useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
    .overrideProvider(EmailService).useValue({ sendEmail: async () => ({}) })
    .overrideProvider(CloudinaryService).useValue({ deleteFile: async (id: string) => { removedCovers.push(id); }, uploadFile: async () => ({ public_id: 'x' }) })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  app.use(cookieParser());
  await app.listen(0);
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P);

  const hash = await bcrypt.hash(PASSWORD, 10);
  let n = 0;
  const mk = async (over: any = {}) => {
    const u = await db.user.create({ data: { name: `Person${++n}Name`, email: `person${n}@test.dev`, emailVerified: true, password: hash, ...over } });
    return { ...u, h: { Authorization: `Bearer ${jwt.sign({ id: u.id, ...(u.role === 'ADMIN' && { role: 'ADMIN' }) }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const admin = await mk({ role: 'ADMIN' });
  const login = (email: string, password = PASSWORD) => request(s).post('/auth/login').set('x-client', 'mobile').send({ email, password });
  const refresh = (token: string) => request(s).post('/auth/refresh').send({ refreshToken: token });
  const resetBy = (u: any, id: string, password = 'brand-new-password') => request(s).patch(`/admin/users/${id}`).set(u.h).send({ password });
  const adminDelete = (id: string, by: any = admin) => request(s).delete(`/admin/users/${id}`).set(by.h);
  const selfDelete = (u: any, body: any = { password: PASSWORD }) => request(s).post('/auth/delete-account').set(u.h).send(body);
  const logsWith = (text: string) => db.$queryRawUnsafe(`SELECT count(*)::int AS c FROM "ActivityLog" WHERE snapshot::text LIKE $1`, `%${text}%`).then((r: any) => r[0].c);

  console.log('--- admin password reset');
  const target = await mk();
  const session = (await login(target.email)).body.refreshToken;
  check('setup: has a session', !!session, true);
  check('too short', (await resetBy(admin, target.id, 'short')).status, 400);
  check('not an admin', (await resetBy(target, target.id)).status, 403);
  check('missing user', (await resetBy(admin, randomUUID())).status, 404);
  const otherAdmin = await mk({ role: 'ADMIN' });
  check('another admin\'s password', (await resetBy(admin, otherAdmin.id)).status, 403);
  check('  unchanged', (await login(otherAdmin.email)).status, 200);
  const reset = await resetBy(admin, target.id);
  check('works', reset.status, 200);
  check('  response has no password', 'password' in reset.body, false);
  check('  new password logs in', (await login(target.email, 'brand-new-password')).status, 200);
  check('  old one doesn\'t', (await login(target.email)).status, 401);
  check('  old session ended', (await refresh(session)).status, 403);
  const resetLog = await db.activityLog.findFirst({ where: { targetUserId: target.id }, orderBy: { createdAt: 'desc' } });
  check('  audited: action', resetLog?.action, 'ADMIN_RESET_PASSWORD');
  check('  audited: who did it', resetLog?.userId, admin.id);
  check('  no password in the log', JSON.stringify(resetLog?.snapshot ?? '').includes('brand-new'), false);
  const feed = await request(s).get('/activity-logs').set(target.h);
  check('  not in the user\'s feed, which older apps can\'t display', feed.body.data?.some((l: any) => l.action === 'ADMIN_RESET_PASSWORD') ?? false, false);

  console.log('--- deletion is refused while money is owed');
  const [al, bob, carol, dave] = [await mk(), await mk(), await mk(), await mk()];
  const debtGroup = await db.group.create({ data: { name: 'Debts', currency: 'EUR', createdById: al.id, members: { create: [{ userId: al.id }, { userId: bob.id }] } } });
  const addTx = (u: any, groupId: string, splits: any[], amount = 10) => request(s).post('/transactions').set(u.h).send({ groupId, amount, category: 'FOOD', description: 'Lunch', paidBy: u.id, splits });
  check('setup', (await addTx(al, debtGroup.id, [{ userId: bob.id, amount: 10 }])).status, 201);
  let r = await adminDelete(al.id);
  check('admin', r.status, 409);
  check('  says why', /settle/i.test(r.body.message), true);
  check('  nothing changed', (await db.user.findUnique({ where: { id: al.id } })).email, al.email);
  check('  still a member', await db.groupMember.count({ where: { userId: al.id } }), 1);
  check('settling', (await request(s).post('/transactions/settle').set(al.h).send({ groupId: debtGroup.id, amount: 10, description: 'Paid back', paidBy: bob.id })).status, 201);

  console.log('--- deleting someone with a shared history');
  const shared = (await request(s).post('/groups').set(al.h).field('name', 'Shared').field('currency', 'EUR')).body;
  await db.groupMember.createMany({ data: [{ groupId: shared.id, userId: carol.id, joinedAt: new Date(2021, 0, 1) }, { groupId: shared.id, userId: bob.id, joinedAt: new Date(2022, 0, 1) }] });
  const sharedTx = await addTx(al, shared.id, [{ userId: al.id, amount: 10 }]);
  check('setup: expense', sharedTx.status, 201);
  check('setup: snapshot with their details', (await request(s).patch(`/groups/${shared.id}`).set(al.h).field('name', 'Shared').field('currency', 'EUR')).status, 200);
  const alone = await db.group.create({ data: { name: 'Alone', currency: 'EUR', cover: 'cover-alone', createdById: al.id, members: { create: { userId: al.id } } } });
  const elsewhere = await db.group.create({ data: { name: 'Bobs', currency: 'EUR', createdById: bob.id, members: { create: [{ userId: bob.id }, { userId: al.id }] } } });
  await db.friendships.create({ data: { senderId: al.id, receiverId: carol.id, status: 'ACCEPTED' } });
  await db.friendships.create({ data: { senderId: dave.id, receiverId: al.id } });
  await db.groupInvitation.create({ data: { groupId: elsewhere.id, senderId: bob.id, receiverId: dave.id } });
  await db.groupInvitation.create({ data: { groupId: shared.id, senderId: al.id, receiverId: dave.id } });
  await db.deviceToken.create({ data: { token: 'ExponentPushToken[al]', platform: 'ios', userId: al.id } });
  await db.emailVerificationOtp.create({ data: { userId: al.id, otpHash: 'x', expiresAt: new Date(Date.now() + 60000) } });
  await db.bugReport.create({ data: { title: 'Bug', description: 'Something broke', email: al.email, name: al.name } });
  const alSession = (await login(al.email)).body.refreshToken;
  check('setup: their email is in snapshots', (await logsWith(al.email)) > 0, true);
  check('setup: bob is too', (await logsWith(bob.email)) > 0, true);

  r = await adminDelete(al.id);
  check('works', r.status, 200);
  check('  nothing private in the response', JSON.stringify(r.body).includes(al.email), false);
  const gone = await db.user.findUnique({ where: { id: al.id }, omit: { password: false } });
  check('  row kept, for shared expenses', !!gone, true);
  check('  name removed', gone.name, 'Deleted user');
  check('  email removed', gone.email.includes(al.email), false);
  check('  password removed', gone.password, null);
  check('  marked deleted', !!gone.deletedAt, true);
  check('  sessions ended', (await refresh(alSession)).status, 403);
  check('  can\'t log in with the old email', (await login(al.email)).status, 401);
  check('  devices removed', await db.deviceToken.count({ where: { userId: al.id } }), 0);
  check('  codes removed', await db.emailVerificationOtp.count({ where: { userId: al.id } }), 0);
  check('  friendships removed', await db.friendships.count({ where: { OR: [{ senderId: al.id }, { receiverId: al.id }] } }), 0);
  check('  invitations they sent removed', await db.groupInvitation.count({ where: { senderId: al.id } }), 0);
  check('  other people\'s invitations kept', await db.groupInvitation.count({ where: { senderId: bob.id } }), 1);
  check('  email gone from every snapshot', await logsWith(al.email), 0);
  check('  name gone from every snapshot', await logsWith(al.name), 0);
  check('  other people left alone in snapshots', (await logsWith(bob.email)) > 0, true);
  check('  bug report kept', await db.bugReport.count({ where: { title: 'Bug' } }), 1);
  check('  without their details', (await db.bugReport.count({ where: { OR: [{ email: al.email }, { name: al.name }] } })), 0);

  console.log('--- what happens to their groups');
  const sharedAfter = await db.group.findUnique({ where: { id: shared.id }, include: { members: true } });
  check('shared group survives', !!sharedAfter, true);
  check('  owner is the longest-standing member', sharedAfter.createdById, carol.id);
  check('  they are not a member', sharedAfter.members.some((m: any) => m.userId === al.id), false);
  check('group only they were in is removed', await db.group.count({ where: { id: alone.id } }), 0);
  check('  and its cover file', removedCovers.includes('cover-alone'), true);
  const elsewhereAfter = await db.group.findUnique({ where: { id: elsewhere.id }, include: { members: true } });
  check('someone else\'s group keeps its owner', elsewhereAfter.createdById, bob.id);
  check('  and loses them', elsewhereAfter.members.length, 1);

  console.log('--- for everyone else');
  r = await request(s).get(`/groups/${shared.id}`).set(bob.h);
  check('group still opens', r.status, 200);
  const shownTx = r.body.transactions?.find((t: any) => t.id === sharedTx.body.id);
  check('  expense kept', !!shownTx, true);
  check('  shown as deleted', shownTx?.paidBy?.name ?? shownTx?.paidBy, 'Deleted user');
  check('  their old email isn\'t anywhere in it', JSON.stringify(r.body).includes(al.email), false);
  check('feed still loads', (await request(s).get('/activity-logs').set(bob.h)).status, 200);
  check('friends still loads', (await request(s).get('/friends').set(carol.h)).status, 200);
  check('can\'t find them in search', (await request(s).get('/users/search?query=Deleted').set(bob.h)).body.length, 0);
  check('can\'t friend them', (await request(s).post(`/friends/requests/${al.id}`).set(bob.h)).status, 404);
  check('can\'t invite them', (await request(s).post(`/groups/${elsewhere.id}/invite/${al.id}`).set(bob.h)).status, 404);
  check('old email can sign up again', (await request(s).post('/auth/register').send({ name: 'New', email: al.email, password: PASSWORD, confirmPassword: PASSWORD })).status, 201);

  console.log('--- for admins');
  check('deleting again', (await adminDelete(al.id)).status, 404);
  check('missing user', (await adminDelete(randomUUID())).status, 404);
  check('not an admin', (await adminDelete(dave.id, dave)).status, 403);
  check('another admin', (await adminDelete(otherAdmin.id)).status, 403);
  check('  still exists', (await db.user.findUnique({ where: { id: otherAdmin.id } })).deletedAt, null);
  const users = await request(s).get('/admin/users').set(admin.h);
  check('not listed any more', users.body.some((u: any) => u.id === al.id), false);
  const delLog = await db.activityLog.findFirst({ where: { action: 'USER_DELETED', targetUserId: al.id } });
  check('audited: who did it', delLog?.userId, admin.id);
  check('  no private details', JSON.stringify(delLog?.snapshot ?? '').includes(al.email), false);
  const activities = await request(s).get('/admin/activites?page=1&limit=100').set(admin.h);
  check('  admin sees it', activities.body.data.some((a: any) => a.action === 'USER_DELETED'), true);

  console.log('--- deleting your own account');
  const self = await mk();
  const selfSession = (await login(self.email)).body.refreshToken;
  check('wrong password', (await selfDelete(self, { password: 'wrong-password' })).status, 403);
  check('no password', (await selfDelete(self, {})).status, 403);
  check('  not logged out by trying', (await refresh(selfSession)).status < 300, true);
  check('not logged in', (await request(s).post('/auth/delete-account').send({ password: PASSWORD })).status, 401);
  const selfOwes = await mk();
  const owed = await db.group.create({ data: { name: 'Owed', currency: 'EUR', createdById: dave.id, members: { create: [{ userId: dave.id }, { userId: selfOwes.id }] } } });
  await addTx(dave, owed.id, [{ userId: selfOwes.id, amount: 10 }]);
  check('owing money', (await selfDelete(selfOwes)).status, 409);
  check('admin can\'t delete themselves here', (await selfDelete(admin)).status, 403);
  r = await selfDelete(self);
  check('right password', r.status, 200);
  check('  cookie cleared', (r.headers['set-cookie'] ?? []).some((c: string) => c.startsWith('jwt=;')), true);
  check('  anonymized', (await db.user.findUnique({ where: { id: self.id } })).name, 'Deleted user');
  check('  audited as themselves', (await db.activityLog.findFirst({ where: { action: 'USER_DELETED', targetUserId: self.id } }))?.userId, self.id);
  const google = await mk({ password: null, provider: 'google' });
  check('Google-only account has no password to ask for', (await selfDelete(google, {})).status, 200);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
