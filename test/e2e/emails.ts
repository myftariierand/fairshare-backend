// End-to-end check of who gets which email and when. The real app and database; only sending is
// replaced, and recorded. Postgres is disposable.
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
const { UsersService } = require(`${R}/users/users.service`);

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const sent: { to: string; subject: string; html: string; text: string }[] = [];
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(require('@nestjs/throttler').ThrottlerStorage).useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
    .overrideProvider(EmailService).useValue({ sendEmail: async (e: any) => { sent.push(e); return {}; } })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.listen(0);
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P); // renderTemplate reads templates/ relative to cwd

  const PASSWORD = 'long-enough-1';
  const hash = await bcrypt.hash(PASSWORD, 4);
  let n = 0;
  const mk = async ({ role = 'USER', emailVerified = true, password = hash as string | null } = {}) => {
    const u = await db.user.create({ data: { name: `Sam Lee${++n}`, email: `u${n}@test.dev`, emailVerified, role, password } });
    return { ...u, h: { Authorization: `Bearer ${jwt.sign({ id: u.id, ...(role === 'ADMIN' && { role }) }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const to = (email: string) => sent.filter((e) => e.to === email);
  const settle = async () => { await sleep(100); };

  console.log('--- welcome');
  const reg = await request(s).post('/auth/register').send({ name: 'Maya Chen', email: 'maya@test.dev', password: PASSWORD, confirmPassword: PASSWORD });
  check('register', reg.status, 201);
  await settle();
  check('a new account gets only its code', to('maya@test.dev').length, 1);
  const verifyMail = to('maya@test.dev')[0];
  check('  with a plain-text version', /^Confirm your email/.test(verifyMail.text), true);
  const code = verifyMail.text.match(/\d{6}/)?.[0];
  check('  and the code in the subject', verifyMail.subject, `${code} is your FairShare code`);
  check('code verifies', (await request(s).post('/auth/verify-email/verify').send({ email: 'maya@test.dev', otp: code })).body.verified, true);
  await settle();
  const welcomes = () => to('maya@test.dev').filter((e) => e.subject.startsWith('Welcome'));
  check('welcome arrives', welcomes().length, 1);
  check('  using the first name', welcomes()[0]?.subject, 'Welcome to FairShare, Maya');

  sent.length = 0;
  await request(s).post('/auth/verify-email/send').send({ email: 'maya@test.dev' });
  await settle();
  check('a verified account gets no new code', to('maya@test.dev').length, 0);

  const early = await db.user.create({ data: { name: 'Early', email: 'early@test.dev', password: hash } });
  await request(s).post('/auth/verify-email/send').send({ email: 'early@test.dev' });
  await settle();
  const earlyCode = to('early@test.dev')[0]?.text.match(/\d{6}/)?.[0];
  const google = mod.get(UsersService);
  await google.findOrCreateGoogleUser('early@test.dev', 'Early');
  await settle();
  check('Google claiming an unverified account welcomes them', to('early@test.dev').filter((e) => e.subject.startsWith('Welcome')).length, 1);
  check('  an old code still counts as verified', (await request(s).post('/auth/verify-email/verify').send({ email: early.email, otp: earlyCode })).body.verified, true);
  await settle();
  check('  but no second welcome', to('early@test.dev').filter((e) => e.subject.startsWith('Welcome')).length, 1);

  await google.findOrCreateGoogleUser('newgoogle@test.dev', 'Goo Gle');
  await settle();
  check('new Google account is welcomed', to('newgoogle@test.dev')[0]?.subject, 'Welcome to FairShare, Goo');
  await google.findOrCreateGoogleUser('newgoogle@test.dev', 'Goo Gle');
  await settle();
  check('  once, not on every sign-in', to('newgoogle@test.dev').length, 1);

  console.log('--- password notices');
  const change = (u: any, body: object) => request(s).post('/auth/change-password').set(u.h).send({ newPassword: 'another-long-1', confirmPassword: 'another-long-1', ...body });
  const a = await mk();
  check('change password', (await change(a, { password: PASSWORD })).status, 201);
  await settle();
  check('changed notice', to(a.email)[0]?.subject, 'Your FairShare password was changed');
  check('  says when, in UTC', / UTC\./.test(to(a.email)[0]?.text.split('\n')[2] ?? ''), true);
  check('  and never the password', to(a.email)[0]?.html.includes('another-long-1'), false);

  const g = await mk({ password: null });
  check('Google account adds a password', (await change(g, {})).status, 201);
  await settle();
  check('added notice', to(g.email)[0]?.subject, 'You added a password to FairShare');

  const un = await mk({ emailVerified: false });
  check('unverified account changes password', (await change(un, { password: PASSWORD })).status, 201);
  await settle();
  check('  an address nobody proved gets nothing', to(un.email).length, 0);

  console.log('--- reset by link');
  const r = await mk();
  await request(s).post('/auth/forgot-password').send({ email: r.email });
  await settle();
  const resetMail = to(r.email)[0];
  check('reset email', resetMail?.subject, 'Reset your FairShare password');
  const token = resetMail?.text.match(/token=([\w.-]+)/)?.[1];
  check('  the text link is not escaped', !!token && !resetMail.text.includes('&#x3D;'), true);
  sent.length = 0;
  check('reset', (await request(s).post('/auth/reset-password').send({ token, password: 'another-long-1', confirmPassword: 'another-long-1' })).status, 201);
  await settle();
  check('reset notice', to(r.email)[0]?.subject, 'Your FairShare password was reset');

  const gr = await mk({ password: null });
  await request(s).post('/auth/forgot-password').send({ email: gr.email });
  await settle();
  check('a Google account is offered a new password', to(gr.email)[0]?.subject, 'Set a password for FairShare');

  console.log('--- by an admin');
  const admin = await mk({ role: 'ADMIN' });
  const t = await mk();
  check('admin resets password', (await request(s).patch(`/admin/users/${t.id}`).set(admin.h).send({ password: 'admin-chosen-1' })).status, 200);
  await settle();
  check('admin notice', to(t.email)[0]?.subject, 'A FairShare admin reset your password');
  check('  and never the password', JSON.stringify(to(t.email)[0]).includes('admin-chosen-1'), false);

  console.log('--- account deleted');
  const d = await mk();
  check('delete own account', (await request(s).post('/auth/delete-account').set(d.h).send({ password: PASSWORD })).status, 200);
  await settle();
  check('goes to the old address', to(d.email)[0]?.subject, 'Your FairShare account has been deleted');
  check('  the self-service wording', to(d.email)[0]?.text.includes('sign up again'), true);
  check('  nothing to the replacement address', sent.some((e) => e.to.endsWith('.invalid')), false);

  const da = await mk();
  check('admin deletes an account', (await request(s).delete(`/admin/users/${da.id}`).set(admin.h)).status, 200);
  await settle();
  check('  says an admin did it', to(da.email)[0]?.text.includes('administrator'), true);

  const du = await mk({ emailVerified: false });
  await request(s).post('/auth/delete-account').set(du.h).send({ password: PASSWORD });
  await settle();
  check('an address nobody proved gets nothing', to(du.email).length, 0);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
