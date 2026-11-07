// End-to-end check that failures look like failures. The real app and database; outages are
// simulated by making one Prisma call reject. Postgres is disposable.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('refusing to run outside the throwaway database');

const P = require('path').resolve(__dirname, '../..');
const R = `${P}/src`;
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const { AppModule } = require(`${R}/app.module`);
const { DatabaseService } = require(`${R}/database/database.service`);
const { EmailService } = require(`${R}/email/email.service`);
const { AuthService } = require(`${R}/auth/auth.service`);

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};

(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(require('@nestjs/throttler').ThrottlerStorage).useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
    .overrideProvider(EmailService).useValue({ sendEmail: async () => ({}) })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.init();
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P);

  const auth = (id: string, role?: string) => ({ Authorization: `Bearer ${jwt.sign({ id, ...(role && { role }) }, process.env.ACCESS_TOKEN_SECRET!)}` });
  let n = 0;
  const mk = async () => {
    const u = await db.user.create({ data: { name: `U${++n}`, email: `u${n}@test.dev`, emailVerified: true, password: 'x' } });
    return { ...u, h: auth(u.id) };
  };
  const [a, b, c] = [await mk(), await mk(), await mk()];
  const ADMIN = auth(a.id, 'ADMIN');
  const none = randomUUID();

  const outage = async (delegate: any, method: string, fn: () => any) => {
    const real = delegate[method];
    delegate[method] = () => Promise.reject(new Error('secret-database-detail'));
    try { return await fn(); } finally { delegate[method] = real; }
  };
  const clean = (r: any) => !JSON.stringify(r.body).includes('secret-database-detail');
  const noInternals = (r: any) => !/required but not found|depends on one or more|Prisma|Invalid `/i.test(JSON.stringify(r.body));

  const group = await db.group.create({ data: { name: 'Trip', currency: 'EUR', createdById: a.id, members: { create: [{ userId: a.id }, { userId: b.id }] } } });

  console.log('--- opening a group you are not in: the audit found a 200 with an exception as its body');
  let r = await request(s).get(`/groups/${group.id}`).set(c.h);
  check('outsider', r.status, 404);
  check('  says why', r.body.message, "This group doesn't exist or you are not a member yet.");
  check('  no exception object in the body', 'response' in r.body, false);
  check('missing group', (await request(s).get(`/groups/${none}`).set(a.h)).status, 404);
  check('member still gets it', (await request(s).get(`/groups/${group.id}`).set(a.h)).body.name, 'Trip');
  r = await outage(db.group, 'findUnique', () => request(s).get(`/groups/${group.id}`).set(a.h));
  check('database failing is a 500', r.status, 500);
  check('  and the details stay private', clean(r), true);

  console.log('--- reads that hid an outage behind an empty 200');
  r = await outage(db.friendships, 'findMany', () => request(s).get('/friends').set(a.h));
  const friendsDown = r.status;
  r = await outage(db.user, 'findUnique', () => request(s).get('/friends').set(a.h));
  check('friends list', Math.max(friendsDown, r.status), 500);
  check('  and the details stay private', clean(r), true);
  r = await outage(db.groupInvitation, 'findMany', () => request(s).get('/groups/invites?status=PENDING').set(a.h));
  check('group invites', r.status, 500);
  check('  and the details stay private', clean(r), true);
  check('friends list normally', (await request(s).get('/friends').set(a.h)).status, 200);
  check('invites normally', (await request(s).get('/groups/invites?status=PENDING').set(a.h)).status, 200);

  console.log('--- a missing transaction: the audit found a 500');
  const tx = await request(s).post('/transactions').set(a.h).send({ groupId: group.id, amount: 10, category: 'FOOD', description: 'Lunch', paidBy: a.id, splits: [{ userId: a.id, amount: 5 }, { userId: b.id, amount: 5 }] });
  check('setup', tx.status, 201);
  check('missing', (await request(s).get(`/transactions/single/${none}`).set(a.h)).status, 404);
  check('not your group', (await request(s).get(`/transactions/single/${tx.body.id}`).set(c.h)).status, 404);
  check('yours', (await request(s).get(`/transactions/single/${tx.body.id}`).set(a.h)).status, 200);
  r = await outage(db.transaction, 'findUnique', () => request(s).get(`/transactions/single/${tx.body.id}`).set(a.h));
  check('database failing is still a 500', r.status, 500);
  check('  and the details stay private', clean(r), true);

  console.log('--- friend requests that are already gone: these were 500s');
  const fr = (m: string, url: string, h: any) => (request(s) as any)[m](`/friends/requests/${url}`).set(h);
  for (const [name, m, path] of [['accept', 'patch', 'accept'], ['reject', 'patch', 'reject'], ['cancel', 'delete', 'cancel'], ['unfriend', 'delete', 'unfriend']]) {
    r = await fr(m, `${none}/${path}`, a.h);
    check(name, r.status, 404);
    check('  nothing internal in the body', noInternals(r), true);
  }

  console.log('--- friend requests working normally');
  const asked = await fr('post', b.id, a.h);
  check('send', asked.status, 201);
  check('send again is still not an error', (await fr('post', b.id, a.h)).status, 201);
  check('someone else can\'t accept it', (await fr('patch', `${asked.body.id}/accept`, c.h)).status, 404);
  check('accept', (await fr('patch', `${asked.body.id}/accept`, b.h)).status, 200);
  check('accepting twice', (await fr('patch', `${asked.body.id}/accept`, b.h)).status, 404);
  check('unfriend', (await fr('delete', `${asked.body.id}/unfriend`, a.h)).status, 200);
  const again = await fr('post', c.id, a.h);
  check('reject', (await fr('patch', `${again.body.id}/reject`, c.h)).status, 200);
  const third = await fr('post', c.id, a.h);
  check('cancel', (await fr('delete', `${third.body.id}/cancel`, a.h)).status, 200);
  r = await fr('post', none, a.h);
  check('asking someone who doesn\'t exist', r.status, 404);
  check('  nothing internal in the body', noInternals(r), true);
  r = await outage(db, '$transaction', () => fr('patch', `${asked.body.id}/accept`, b.h));
  check('database failing is still a 500', r.status, 500);
  check('  and the details stay private', clean(r), true);

  console.log('--- the catch-all for records that are gone');
  check('admin: update missing bug', (await request(s).patch(`/admin/bugs/${none}`).set(ADMIN).send({ status: 'OPEN' })).status, 404);
  check('admin: delete missing bug', (await request(s).delete(`/admin/bugs/${none}`).set(ADMIN)).status, 404);
  check('admin: update missing user', (await request(s).patch(`/admin/users/${none}`).set(ADMIN).send({ password: 'long-enough-1' })).status, 404);
  check('admin: delete missing user', (await request(s).delete(`/admin/users/${none}`).set(ADMIN)).status, 404);
  r = await request(s).delete(`/admin/users/${a.id}`).set(ADMIN);
  check('admin: delete a user who is owed money', r.status, 409);
  check('  nothing internal in the body', noInternals(r), true);
  check('  and they still exist', (await db.user.findUnique({ where: { id: a.id } })).name, a.name);
  r = await request(s).delete(`/groups/${group.id}/leave`).set(c.h);
  check('leaving a group you aren\'t in', r.status, 404);
  check('  nothing internal in the body', noInternals(r), true);

  console.log('--- Prisma\'s words in the response');
  r = await request(s).delete(`/groups/${group.id}`).set(b.h);
  check('deleting someone else\'s group', r.status, 404);
  check('  nothing internal in the body', noInternals(r), true);
  check('  has a message', typeof r.body.message, 'string');
  check('  and it still exists', await db.group.count({ where: { id: group.id } }), 1);
  r = await request(s).patch(`/groups/${none}`).set(a.h).field('name', 'New').field('currency', 'EUR');
  check('updating a missing group', r.status, 404);
  check('  nothing internal in the body', noInternals(r), true);

  console.log('--- password reset reporting an outage as "invalid token"');
  const fingerprint = (mod.get(AuthService) as any).passwordFingerprint('x');
  const good = jwt.sign({ id: a.id, pwd: fingerprint }, process.env.RESET_PASSWORD_SECRET!);
  const reset = (token: string) => request(s).post('/auth/reset-password').send({ token, password: 'brand-new-password', confirmPassword: 'brand-new-password' });
  const verify = (token: string) => request(s).get('/auth/verify-reset-token').query({ token });
  check('verify: garbage', (await verify('garbage')).status, 401);
  check('verify: signed with another key', (await verify(jwt.sign({ id: a.id }, 'other-key'))).status, 401);
  check('verify: expired', (await verify(jwt.sign({ id: a.id, pwd: fingerprint }, process.env.RESET_PASSWORD_SECRET!, { expiresIn: -1 }))).status, 401);
  check('verify: no user in it', (await verify(jwt.sign({ pwd: fingerprint }, process.env.RESET_PASSWORD_SECRET!))).status, 401);
  check('verify: real link', (await verify(good)).status < 300, true);
  check('reset: garbage', (await reset('garbage')).status, 403);
  check('reset: no user in it', (await reset(jwt.sign({ pwd: fingerprint }, process.env.RESET_PASSWORD_SECRET!))).status, 403);
  r = await outage(db.user, 'findUnique', () => verify(good));
  check('verify: database failing is a 500', r.status, 500);
  check('  and the details stay private', clean(r), true);
  r = await outage(db.user, 'findUnique', () => reset(good));
  check('reset: database failing is a 500', r.status, 500);
  check('  and the details stay private', clean(r), true);
  r = await outage(db, '$transaction', () => reset(good));
  check('reset: failing while saving is a 500', r.status, 500);
  check('reset: real link', (await reset(good)).status < 300, true);
  check('reset: same link again', (await reset(good)).status, 403);

  console.log('--- a logged-in account that no longer exists');
  r = await request(s).get('/auth/profile').set(auth(none));
  check('profile', r.status, 401);
  check('real profile', (await request(s).get('/auth/profile').set(a.h)).status, 200);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
