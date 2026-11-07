// Throwaway test of real failures and real races on a disposable Postgres. A database trigger makes
// activity log inserts fail on demand, and concurrent requests really run in parallel. Run with cwd=scratchpad.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('refusing to run outside the throwaway database');

const P = require('path').resolve(__dirname, '../..');
const R = `${P}/src`;
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { Expo } from 'expo-server-sdk';

let pushes = 0;
(Expo.prototype as any).sendPushNotificationsAsync = async () => { pushes++; return []; };

const { AppModule } = require(`${R}/app.module`);
const { DatabaseService } = require(`${R}/database/database.service`);
const { EmailService } = require(`${R}/email/email.service`);
const { CloudinaryService } = require(`${R}/cloudinary/cloudinary.service`);
const { SseService } = require(`${R}/sse/sse.service`);
const { Prisma } = require('@prisma/client');
(Prisma.Decimal.prototype as any).toJSON = function () { return this.toNumber(); };

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};

(async () => {
  const deleted: string[] = [];
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(require('@nestjs/throttler').ThrottlerStorage).useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
    .overrideProvider(EmailService).useValue({ sendEmail: async () => ({}) })
    .overrideProvider(CloudinaryService).useValue({ uploadFile: async () => ({ public_id: 'group/new' }), deleteFile: async (id: string) => { deleted.push(id); return {}; } })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.listen(0);
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P);

  const events: string[] = [];
  const sse = mod.get(SseService);
  const emit = sse.emit.bind(sse);
  sse.emit = (r: string[], t: string, m: string) => { events.push(t); return emit(r, t, m); };

  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION audit_fail_log() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated log failure'; END $$ LANGUAGE plpgsql`);
  await db.$executeRawUnsafe(`CREATE TRIGGER audit_fail_log BEFORE INSERT ON "ActivityLog" FOR EACH ROW EXECUTE FUNCTION audit_fail_log()`);
  const failLogs = (on: boolean) => db.$executeRawUnsafe(`ALTER TABLE "ActivityLog" ${on ? 'ENABLE' : 'DISABLE'} TRIGGER audit_fail_log`);
  await failLogs(false);

  let n = 0;
  const mk = async (password = 'old-password') => {
    const email = `u${++n}@test.dev`;
    const u = await db.user.create({ data: { name: email.split('@')[0], email, emailVerified: true, password: await bcrypt.hash(password, 4) } });
    return { id: u.id, email, h: { Authorization: `Bearer ${jwt.sign({ id: u.id }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const mkGroup = async (owner: any, members: any[] = []) => {
    const g = (await request(s).post('/groups').set(owner.h).field('name', 'G').field('currency', 'EUR')).body;
    for (const m of members) await db.groupMember.create({ data: { groupId: g.id, userId: m.id } });
    return g.id as string;
  };
  const expense = (u: any, g: string, paidBy: any, debtor: any, amount = 10) =>
    request(s).post('/transactions').set(u.h).send({ groupId: g, amount, category: 'FOOD', description: 'Stuff', paidBy: paidBy.id, splits: [{ userId: debtor.id, amount }] });

  // Runs an action with logging broken: it must fail, and the database must look the same afterwards
  const atomic = async (name: string, action: () => any, snapshot: () => Promise<any>) => {
    const before = JSON.stringify(await snapshot());
    const logs = await db.activityLog.count();
    const ev = events.length;
    const pu = pushes;
    await failLogs(true);
    const r = await action();
    await failLogs(false);
    await new Promise((f) => setTimeout(f, 40));
    check(`${name}: reports failure`, r.status >= 500, true);
    check(`${name}: nothing saved`, JSON.stringify(await snapshot()) === before, true);
    check(`${name}: no notifications`, events.length === ev && pushes === pu, true);
    check(`${name}: no log`, await db.activityLog.count(), logs);
  };

  console.log('--- money: all or nothing');
  const a = await mk();
  const b = await mk();
  const G = await mkGroup(a, [b]);
  await db.deviceToken.create({ data: { token: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]', platform: 'ios', userId: b.id } });
  const money = async () => ({
    tx: await db.transaction.findMany({ where: { groupId: G }, orderBy: { id: 'asc' }, include: { splits: { orderBy: { userId: 'asc' }, select: { userId: true, amount: true } } } }),
    debts: (await db.group.findUnique({ where: { id: G } })).remainingDebts,
  });
  await atomic('create expense', () => expense(a, G, a, b), money);
  const T = (await expense(a, G, a, b)).body.id;
  check('  (works normally)', !!T, true);
  await atomic('edit expense', () => request(s).patch(`/transactions/${T}`).set(a.h).send({ groupId: G, amount: 5, category: 'FOOD', description: 'Changed', paidBy: a.id, splits: [{ userId: b.id, amount: 5 }] }), money);
  await atomic('settle', () => request(s).post('/transactions/settle').set(a.h).send({ groupId: G, amount: 10, description: 'paid', paidBy: b.id }), money);
  await atomic('delete expense', () => request(s).delete(`/transactions/${T}`).set(a.h), money);

  console.log('--- groups: all or nothing');
  const c = await mk();
  const groupState = async () => ({ g: await db.group.findUnique({ where: { id: G }, select: { name: true, cover: true, inviteToken: true } }), members: await db.groupMember.count({ where: { groupId: G } }), invites: await db.groupInvitation.findMany({ where: { groupId: G }, orderBy: { id: 'asc' }, select: { id: true, status: true } }) });
  const groupCount = () => db.group.count().then((x: number) => ({ x }));
  await atomic('create group', () => request(s).post('/groups').set(a.h).field('name', 'New').field('currency', 'EUR'), groupCount);
  await db.group.update({ where: { id: G }, data: { cover: 'group/old' } });
  deleted.length = 0;
  await atomic('update group', () => request(s).patch(`/groups/${G}`).set(a.h).field('name', 'Renamed').field('currency', 'EUR').field('removeCover', 'true'), groupState);
  check('  cover file kept', deleted.length, 0);
  await atomic('invite', () => request(s).post(`/groups/${G}/invite/${c.id}`).set(a.h), groupState);
  const inv = (await request(s).post(`/groups/${G}/invite/${c.id}`).set(a.h)).body;
  await atomic('accept invite', () => request(s).post(`/groups/${G}/invite/${inv.id}/accept`).set(c.h), groupState);
  await atomic('reject invite', () => request(s).post(`/groups/invite/${inv.id}/reject`).set(c.h), groupState);
  const token = (await db.group.findUnique({ where: { id: G }, select: { inviteToken: true } })).inviteToken;
  const d = await mk();
  await atomic('join by link', () => request(s).post(`/groups/join/${token}`).set(d.h), groupState);
  const e = await mk();
  await db.groupMember.create({ data: { groupId: G, userId: e.id } });
  await atomic('remove member', () => request(s).delete(`/groups/${G}/remove/${e.id}`).set(a.h), groupState);
  await atomic('leave group', () => request(s).delete(`/groups/${G}/leave`).set(e.h), groupState);
  const H = await mkGroup(a);
  await db.group.update({ where: { id: H }, data: { cover: 'group/keep' } });
  const hExists = async () => !!(await db.group.findUnique({ where: { id: H } }));
  deleted.length = 0;
  await atomic('delete group', () => request(s).delete(`/groups/${H}`).set(a.h), hExists);
  check('  still exists', await hExists(), true);
  check('  cover file kept', deleted.length, 0);

  console.log('--- friends: all or nothing');
  const f1 = await mk();
  const f2 = await mk();
  const friends = () => db.friendships.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true } });
  await atomic('send request', () => request(s).post(`/friends/requests/${f2.id}`).set(f1.h), friends);
  const fr = (await request(s).post(`/friends/requests/${f2.id}`).set(f1.h)).body;
  await atomic('accept request', () => request(s).patch(`/friends/requests/${fr.id}/accept`).set(f2.h), friends);
  await atomic('reject request', () => request(s).patch(`/friends/requests/${fr.id}/reject`).set(f2.h), friends);
  await atomic('cancel request', () => request(s).delete(`/friends/requests/${fr.id}/cancel`).set(f1.h), friends);
  await request(s).patch(`/friends/requests/${fr.id}/accept`).set(f2.h);
  await atomic('unfriend', () => request(s).delete(`/friends/requests/${fr.id}/unfriend`).set(f1.h), friends);
  check('sending a request twice still returns normally', (await request(s).post(`/friends/requests/${f2.id}`).set(f1.h)).status, 201);

  console.log('--- accounts: all or nothing');
  const reg = { name: 'New', email: 'newperson@test.dev', password: 'password-1', confirmPassword: 'password-1' };
  const userCount = () => db.user.count().then((x: number) => ({ x }));
  await atomic('register', () => request(s).post('/auth/register').set('x-client', 'mobile').send(reg), userCount);
  check('  email can be used afterwards (retry works)', (await request(s).post('/auth/register').set('x-client', 'mobile').send(reg)).status, 201);
  const pw = await mk();
  const session = (await request(s).post('/auth/login').set('x-client', 'mobile').send({ email: pw.email, password: 'old-password' })).body.refreshToken;
  const pwState = async () => ({ p: (await db.user.findUnique({ where: { id: pw.id }, omit: { password: false } })).password, rows: await db.refreshToken.count({ where: { userId: pw.id } }) });
  await atomic('change password', () => request(s).post('/auth/change-password').set(pw.h).send({ password: 'old-password', newPassword: 'new-password-1', confirmPassword: 'new-password-1' }), pwState);
  check('  old password still works', (await request(s).post('/auth/login').set('x-client', 'mobile').send({ email: pw.email, password: 'old-password' })).status, 200);
  check('  session still works', (await request(s).post('/auth/refresh').send({ refreshToken: session })).status, 201);
  await atomic('update profile', () => request(s).post('/auth/update-profile').set(pw.h).send({ name: 'Changed' }), () => db.user.findUnique({ where: { id: pw.id }, select: { name: true } }));

  console.log('--- email verification');
  const hash = (x: string) => createHash('sha256').update(x).digest('hex');
  const setOtp = async (u: any, code: string, attempts = 0) => db.emailVerificationOtp.upsert({ where: { userId: u.id }, create: { userId: u.id, otpHash: hash(code), expiresAt: new Date(Date.now() + 300000), attempts }, update: { otpHash: hash(code), attempts, expiresAt: new Date(Date.now() + 300000) } });
  const verify = (u: any, otp: string) => request(s).post('/auth/verify-email/verify').send({ email: u.email, otp });
  const ov = await mk();
  await db.user.update({ where: { id: ov.id }, data: { emailVerified: false } });
  await setOtp(ov, '123456');
  const ovState = async () => ({ v: (await db.user.findUnique({ where: { id: ov.id } })).emailVerified, code: !!(await db.emailVerificationOtp.findUnique({ where: { userId: ov.id } })) });
  const beforeOv = JSON.stringify(await ovState());
  await failLogs(true);
  const failed = await verify(ov, '123456');
  await failLogs(false);
  check('right code with logging broken fails', failed.status >= 500, true);
  check('  not verified, code not used up', JSON.stringify(await ovState()), beforeOv);
  check('right code works', (await verify(ov, '123456')).body.verified, true);
  check('  verified', (await ovState()).v, true);
  check('  logged once', await db.activityLog.count({ where: { userId: ov.id, action: 'USER_EMAIL_VERIFIED' } }), 1);

  console.log('--- race: guessing a code in parallel');
  const og = await mk();
  await setOtp(og, '111111');
  const guesses = await Promise.all(Array.from({ length: 25 }, () => verify(og, '000000')));
  check('every guess gets the same answer', guesses.filter((r) => r.status === 201 && r.body.verified === false).length, 25);
  check('attempts stop at the limit', (await db.emailVerificationOtp.findUnique({ where: { userId: og.id } })).attempts, 5);
  check('the right code is refused after that', (await verify(og, '111111')).body.verified, false);
  const ot = await mk();
  await db.user.update({ where: { id: ot.id }, data: { emailVerified: false } });
  await setOtp(ot, '222222');
  const same = await Promise.all(Array.from({ length: 4 }, () => verify(ot, '222222')));
  check('the right code sent 4 times at once only succeeds once', same.filter((r) => r.body.verified === true).length, 1);
  check('  logged once', await db.activityLog.count({ where: { userId: ot.id, action: 'USER_EMAIL_VERIFIED' } }), 1);

  console.log('--- race: marking a debt as paid twice');
  const p1 = await mk();
  const p2 = await mk();
  const R1 = await mkGroup(p1, [p2]);
  await expense(p1, R1, p1, p2, 10);
  const pays = await Promise.all(Array.from({ length: 8 }, () => request(s).post('/transactions/settle').set(p1.h).send({ groupId: R1, amount: 10, description: 'paid', paidBy: p2.id })));
  check('8 at once: exactly one succeeds', pays.filter((r) => r.status === 201).length, 1);
  check('  the others are refused cleanly', pays.filter((r) => r.status === 400).length, 7);
  check('  one payment recorded', await db.transaction.count({ where: { groupId: R1, type: 'SETTLEMENT' } }), 1);
  check('  no debt flipped the wrong way', (await request(s).get(`/groups/${R1}`).set(p1.h)).body.settlements.length, 0);

  console.log('--- race: leaving while someone adds an expense');
  let both = 0, neither = 0, rounds = 0;
  for (let i = 0; i < 12; i++) {
    const x = await mk();
    const y = await mk();
    const g = await mkGroup(x, [y]);
    const [ex, lv] = await Promise.all([expense(x, g, x, y, 10), request(s).delete(`/groups/${g}/leave`).set(y.h)]);
    rounds++;
    if (ex.status === 201 && lv.status === 200) both++;
    if (ex.status !== 201 && lv.status !== 200) neither++;
    const isMember = !!(await db.groupMember.findUnique({ where: { groupId_userId: { groupId: g, userId: y.id } } }));
    const owes = await db.transaction.count({ where: { groupId: g } });
    if (owes && !isMember) both += 100;
  }
  check(`${rounds} rounds: nobody ever leaves owing money`, both, 0);
  check('  one of the two always succeeds', neither, 0);

  console.log('--- race: many writers keep the debt count right');
  const w = await mk();
  const members = await Promise.all(Array.from({ length: 6 }, () => mk()));
  const R2 = await mkGroup(w, members);
  const added = await Promise.all(members.map((m) => expense(w, R2, w, m, 5)));
  check('6 parallel expenses all succeed', added.every((r) => r.status === 201), true);
  check('  remainingDebts is exact', (await db.group.findUnique({ where: { id: R2 } })).remainingDebts, 6);
  const paid = await Promise.all(members.map((m) => request(s).post('/transactions/settle').set(w.h).send({ groupId: R2, amount: 5, description: 'paid', paidBy: m.id })));
  check('6 parallel settlements all succeed', paid.every((r) => r.status === 201), true);
  check('  remainingDebts is exact', (await db.group.findUnique({ where: { id: R2 } })).remainingDebts, 0);

  console.log('--- race: same person joining twice');
  const j = await mk();
  const R3 = await mkGroup(w);
  const t3 = (await db.group.findUnique({ where: { id: R3 }, select: { inviteToken: true } })).inviteToken;
  const joins = await Promise.all(Array.from({ length: 6 }, () => request(s).post(`/groups/join/${t3}`).set(j.h)));
  check('all return normally (some were 500s)', joins.every((r) => r.status === 201), true);
  check('  member added once', await db.groupMember.count({ where: { groupId: R3, userId: j.id } }), 1);
  check('  logged once', await db.activityLog.count({ where: { groupId: R3, action: 'GROUP_MEMBER_JOINED' } }), 1);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
