// End-to-end check of the smaller behaviour changes from the Low findings. The real app and database; only
// email is replaced, and recorded. Postgres is disposable.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
process.env.NOTIFICATION_EMAIL = 'alerts@test.dev';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('refusing to run outside the throwaway database');

const P = require('path').resolve(__dirname, '../..');
const R = `${P}/src`;
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { createHash } from 'crypto';

const { AppModule } = require(`${R}/app.module`);
const { DatabaseService } = require(`${R}/database/database.service`);
const { EmailService } = require(`${R}/email/email.service`);

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const sent: { to: string; subject: string; html: string }[] = [];
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(require('@nestjs/throttler').ThrottlerStorage).useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
    .overrideProvider(EmailService).useValue({ sendEmail: async (e: any) => { sent.push(e); return {}; } })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.listen(0);
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P);

  let n = 0;
  const mk = async (role = 'USER') => {
    const u = await db.user.create({ data: { name: `U${++n}`, email: `u${n}@test.dev`, emailVerified: true, role } });
    return { ...u, h: { Authorization: `Bearer ${jwt.sign({ id: u.id, ...(role === 'ADMIN' && { role }) }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const [a, b, admin] = [await mk(), await mk(), await mk('ADMIN')];

  console.log('--- owner notifications go to the configured address');
  const register = (email: string) => request(s).post('/auth/register').send({ name: 'New', email, password: 'long-enough-1', confirmPassword: 'long-enough-1' });
  check('sign up', (await register('new1@test.dev')).status, 201);
  await sleep(50);
  const notice = sent.find((e) => e.subject === 'New user registered');
  check('  sent there', notice?.to, 'alerts@test.dev');
  check('  addressed to nobody in particular', notice?.html.includes('Erand'), false);
  check('bug report', (await request(s).post('/bug-reports').set(a.h).send({ title: 'It broke', description: 'It broke when I clicked' })).status, 201);
  await sleep(50);
  check('  sent there', sent.find((e) => e.subject.startsWith('New Bug Report'))?.to, 'alerts@test.dev');
  sent.length = 0;
  delete process.env.NOTIFICATION_EMAIL;
  check('with none configured, sign up still works', (await register('new2@test.dev')).status, 201);
  check('  bug reports too', (await request(s).post('/bug-reports').set(a.h).send({ title: 'It broke', description: 'It broke when I clicked' })).status, 201);
  await sleep(50);
  check('  and no notice goes anywhere', sent.filter((e) => e.subject === 'New user registered' || e.subject.startsWith('New Bug Report')).length, 0);

  console.log('--- splits that don\'t add up are a bad request, not a permissions problem');
  const g = await db.group.create({ data: { name: 'Trip', currency: 'EUR', createdById: a.id, members: { create: [{ userId: a.id }, { userId: b.id }] } } });
  const tx = (u: any, over: any = {}) => request(s).post('/transactions').set(u.h).send({ groupId: g.id, amount: 10, category: 'FOOD', description: 'Lunch', paidBy: a.id, splits: [{ userId: a.id, amount: 5 }, { userId: b.id, amount: 5 }], ...over });
  let r = await tx(a, { amount: 99 });
  check('create', r.status, 400);
  check('  says why', /sum of the splits/i.test(r.body.message), true);
  const made = await tx(a);
  check('a good one', made.status, 201);
  check('update', (await request(s).patch(`/transactions/${made.body.id}`).set(a.h).send({ groupId: g.id, amount: 99, category: 'FOOD', description: 'Lunch', paidBy: a.id, splits: [{ userId: a.id, amount: 5 }] })).status, 400);

  console.log('--- the admin route, spelled right');
  check('new spelling', (await request(s).get('/admin/activities?page=1&limit=25').set(admin.h)).status, 200);
  check('old spelling keeps working for an admin app not yet deployed', (await request(s).get('/admin/activites?page=1&limit=25').set(admin.h)).status, 200);
  check('both are admin only', (await request(s).get('/admin/activities').set(a.h)).status, 403);

  console.log('--- verification codes at rest');
  const fresh = await db.user.create({ data: { name: 'Otp', email: 'otp@test.dev' } });
  sent.length = 0;
  await request(s).post('/auth/verify-email/send').send({ email: fresh.email });
  await sleep(100);
  const code = sent.find((e) => e.to === fresh.email)?.html.match(/\d{6}/)?.[0] as string;
  check('code is sent', /^\d{6}$/.test(code), true);
  const row = await db.emailVerificationOtp.findUnique({ where: { userId: fresh.id } });
  check('a plain hash of it isn\'t stored, which anyone could reverse', row.otpHash === createHash('sha256').update(code).digest('hex'), false);
  check('wrong code', (await request(s).post('/auth/verify-email/verify').send({ email: fresh.email, otp: code === '123456' ? '654321' : '123456' })).body.verified, false);
  check('right code', (await request(s).post('/auth/verify-email/verify').send({ email: fresh.email, otp: code })).body.verified, true);

  console.log('--- passwords never appear in a response, now that only the database layer guards this');
  const profile = await request(s).get('/auth/profile').set(a.h);
  check('profile', 'password' in profile.body, false);
  const search = await request(s).get(`/users/search?query=${b.email}`).set(a.h);
  check('search', JSON.stringify(search.body).includes('password'), false);
  const users = await request(s).get('/admin/users').set(admin.h);
  check('admin users', JSON.stringify(users.body).includes('"password"'), false);

  console.log('--- tasks still notify and save');
  const task = await request(s).post(`/groups/${g.id}/tasks`).set(a.h).send({ text: 'Book it' });
  check('add', task.status, 201);
  check('update', (await request(s).patch(`/groups/${g.id}/tasks/${task.body.id}`).set(a.h).send({ done: true })).status, 200);
  check('reorder', (await request(s).put(`/groups/${g.id}/tasks/reorder`).set(a.h).send({ orderedIds: [task.body.id] })).status, 200);
  check('remove', (await request(s).delete(`/groups/${g.id}/tasks/${task.body.id}`).set(a.h)).status, 200);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
