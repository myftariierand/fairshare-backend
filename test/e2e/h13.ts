// End-to-end check against a disposable Postgres container. Real AppModule, real Prisma and the
// real reset email template; sending is stubbed and the link is read from the rendered email.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('refusing to run outside the throwaway database');

const P = require('path').resolve(__dirname, '../..');
const R = `${P}/src`;
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';

const { AppModule } = require(`${R}/app.module`);
const { DatabaseService } = require(`${R}/database/database.service`);
const { EmailService } = require(`${R}/email/email.service`);

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};

(async () => {
  let lastHtml = '';
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(require('@nestjs/throttler').ThrottlerStorage).useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
    .overrideProvider(EmailService).useValue({ sendEmail: async ({ html }: any) => { lastHtml = html; return {}; } })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.init();
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P);

  let n = 0;
  const mk = async (password: string | null = 'old-password') => {
    const email = `u${++n}@test.dev`;
    const u = await db.user.create({ data: { name: email, email, emailVerified: true, password: password && (await bcrypt.hash(password, 4)) } });
    return { id: u.id, email, h: { Authorization: `Bearer ${jwt.sign({ id: u.id }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const link = async (email: string) => {
    lastHtml = '';
    await request(s).post('/auth/forgot-password').send({ email });
    await new Promise((r) => setTimeout(r, 50)); // the email now goes out in the background
    const m = lastHtml.replace(/&#x3D;/g, '=').match(/token=([^'"&]+)/);
    return m?.[1] as string;
  };
  const reset = (token: string, password = 'brand-new-password') => request(s).post('/auth/reset-password').send({ token, password, confirmPassword: password });
  const verify = (token: string) => request(s).get('/auth/verify-reset-token').query({ token });
  const login = (email: string, password: string) => request(s).post('/auth/login').send({ email, password });

  console.log('--- a reset link works once');
  let u = await mk();
  let t = await link(u.email);
  check('email contains a token', !!t, true);
  check('link checks out', (await verify(t)).status, 200);
  check('reset', (await reset(t)).status, 201);
  check('  new password works', (await login(u.email, 'brand-new-password')).status, 200);
  check('  old password does not', (await login(u.email, 'old-password')).status, 401);
  check('using the link again (used to work)', (await reset(t, 'attacker-password')).status, 403);
  check('  attacker password did not take', (await login(u.email, 'attacker-password')).status, 401);
  check('  the link now reports invalid', (await verify(t)).status, 401);

  console.log('--- other password changes cancel outstanding links');
  u = await mk();
  const a = await link(u.email);
  const b = await link(u.email);
  check('two links for the same password both work at first', (await verify(a)).status === 200 && (await verify(b)).status === 200, true);
  check('using one', (await reset(b)).status, 201);
  check('  cancels the other', (await reset(a, 'attacker-password')).status, 403);
  u = await mk();
  t = await link(u.email);
  check('change password', (await request(s).post('/auth/change-password').set(u.h).send({ password: 'old-password', newPassword: 'changed-password', confirmPassword: 'changed-password' })).status, 201);
  check('  stolen link no longer works', (await reset(t, 'attacker-password')).status, 403);
  u = await mk();
  t = await link(u.email);
  await db.user.update({ where: { id: u.id }, data: { password: await bcrypt.hash('same-password-rehash', 4) } });
  check('admin or any other password change cancels it too', (await reset(t, 'attacker-password')).status, 403);

  console.log('--- bad tokens');
  u = await mk();
  const secret = process.env.RESET_PASSWORD_SECRET!;
  check('old-style token with no fingerprint', (await reset(jwt.sign({ id: u.id }, secret))).status, 403);
  check('wrong fingerprint', (await reset(jwt.sign({ id: u.id, pwd: 'guess' }, secret))).status, 403);
  check('wrong secret', (await reset(jwt.sign({ id: u.id, pwd: 'x' }, 'other-secret-other-secret-other-secret'))).status, 403);
  check('garbage', (await reset('garbage')).status, 403);
  t = await link(u.email);
  const claims: any = jwt.decode(t);
  check('expired', (await reset(jwt.sign({ id: u.id, pwd: claims.pwd, exp: Math.floor(Date.now() / 1000) - 10 }, secret))).status, 403);
  check("one user's fingerprint on another's token", (await reset(jwt.sign({ id: (await mk('different')).id, pwd: claims.pwd }, secret))).status, 403);
  check('deleted user', await (async () => { const d = await mk(); const dt = await link(d.email); await db.user.delete({ where: { id: d.id } }); return (await reset(dt)).status; })(), 403);
  check('token does not contain the password hash', JSON.stringify(claims).includes('$2b$'), false);
  check('link expires in an hour', claims.exp - claims.iat, 3600);

  console.log('--- accounts with no password');
  u = await mk(null);
  t = await link(u.email);
  check('Google user can set a password by reset', (await reset(t)).status, 201);
  check('  and log in with it', (await login(u.email, 'brand-new-password')).status, 200);
  check('  once only', (await reset(t, 'attacker-password')).status, 403);

  console.log('--- forgot password');
  check('invalid email is a 400 (was a 500)', (await request(s).post('/auth/forgot-password').send({})).status, 400);
  const known = await request(s).post('/auth/forgot-password').send({ email: u.email });
  const unknown = await request(s).post('/auth/forgot-password').send({ email: 'nobody@test.dev' });
  check('same answer for known and unknown emails', known.status === unknown.status && known.body.message === unknown.body.message, true);

  console.log('--- password rules when setting one');
  const reg = (password: string) => request(s).post('/auth/register').set('x-client', 'mobile').send({ name: 'n', email: `r${Math.random()}@test.dev`, password, confirmPassword: password });
  check('register: 7 characters', (await reg('1234567')).status, 400);
  check('register: 8 characters', (await reg('12345678')).status, 201);
  check('register: 72 characters', (await reg('a'.repeat(72))).status, 201);
  check('register: 73 characters', (await reg('a'.repeat(73))).status, 400);
  check('register: 25 emoji is 100 bytes', (await reg('😀'.repeat(25))).status, 400);
  check('register: NUL byte', (await reg('12345678\0')).status, 400);
  u = await mk();
  const change = (newPassword: string) => request(s).post('/auth/change-password').set(u.h).send({ password: 'old-password', newPassword, confirmPassword: newPassword });
  check('change password: 7 characters', (await change('1234567')).status, 400);
  check('  says why in the errors', JSON.stringify((await change('1234567')).body).includes('at least 8'), true);
  t = await link(u.email);
  check('reset: 7 characters', (await reset(t, '1234567')).status, 400);
  check('  link still usable', (await verify(t)).status, 200);
  const ad = await mk();
  await db.user.update({ where: { id: ad.id }, data: { role: 'ADMIN' } });
  const admin = { Authorization: `Bearer ${jwt.sign({ id: ad.id, role: 'ADMIN' }, process.env.ACCESS_TOKEN_SECRET!)}` };
  check('admin: 7 characters', (await request(s).patch(`/admin/users/${u.id}`).set(admin).send({ password: '1234567' })).status, 400);
  check('admin: 8 characters', (await request(s).patch(`/admin/users/${u.id}`).set(admin).send({ password: '12345678' })).status, 200);

  console.log('--- existing accounts are not locked out');
  const short = await mk('abc');
  check('existing short password can still log in', (await login(short.email, 'abc')).status, 200);
  check('  and can change to a stronger one', (await request(s).post('/auth/change-password').set(short.h).send({ password: 'abc', newPassword: 'stronger-password', confirmPassword: 'stronger-password' })).status, 201);
  const long = await mk('b'.repeat(100));
  check('existing very long password can still log in', (await login(long.email, 'b'.repeat(100))).status, 200);
  check('empty login still refused', (await login(long.email, '')).status, 400);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
