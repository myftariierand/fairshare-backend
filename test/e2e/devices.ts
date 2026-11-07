// End-to-end check of who keeps receiving someone's notifications. The real app and database; only email
// is replaced. Postgres is disposable.
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
const { AuthService } = require(`${R}/auth/auth.service`);

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};
const PASSWORD = 'correct-password-1';

(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(require('@nestjs/throttler').ThrottlerStorage).useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
    .overrideProvider(EmailService).useValue({ sendEmail: async () => ({}) })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.listen(0);
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P);

  const hash = await bcrypt.hash(PASSWORD, 10);
  let n = 0;
  const mk = async (over: any = {}) => {
    const u = await db.user.create({ data: { name: `U${++n}`, email: `u${n}@test.dev`, emailVerified: true, password: hash, ...over } });
    return { ...u, h: { Authorization: `Bearer ${jwt.sign({ id: u.id, ...(u.role === 'ADMIN' && { role: 'ADMIN' }) }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  let t = 0;
  const token = () => `ExponentPushToken[device${++t}]`;
  const register = (u: any, value: string, platform = 'ios') => request(s).post('/devices').set(u.h).send({ token: value, platform });
  const countFor = (u: any) => db.deviceToken.count({ where: { userId: u.id } });
  const ownerOf = async (value: string) => (await db.deviceToken.findUnique({ where: { token: value } }))?.userId ?? null;
  const login = (u: any) => request(s).post('/auth/login').set('x-client', 'mobile').send({ email: u.email, password: PASSWORD });

  console.log('--- registering');
  const a = await mk();
  check('not a push token', (await register(a, 'not-a-push-token')).status, 400);
  const first = token();
  const r = await register(a, first);
  check('real token', r.status, 201);
  check('  saved', await ownerOf(first), a.id);
  check('  response says nothing about the account', 'userId' in r.body || 'token' in r.body, false);
  check('registering again changes nothing', (await register(a, first)).status, 201);
  check('  one row', await countFor(a), 1);

  console.log('--- the same phone signing in to another account');
  const b = await mk();
  check('moves to them', (await register(b, first)).status, 201);
  check('  they get the notifications now', await ownerOf(first), b.id);
  check('  the last account doesn\'t', await countFor(a), 0);

  console.log('--- someone registering endless devices');
  const hoarder = await mk();
  const tokens = Array.from({ length: 13 }, token);
  for (const value of tokens) await register(hoarder, value);
  check('capped', await countFor(hoarder), 10);
  check('  newest kept', await ownerOf(tokens[12]), hoarder.id);
  check('  oldest dropped', await ownerOf(tokens[0]), null);
  await register(hoarder, tokens[3]);
  await register(hoarder, token());
  check('using a device again keeps it', await ownerOf(tokens[3]), hoarder.id);

  console.log('--- signing out');
  const out = await mk();
  const phone = token();
  await register(out, phone);
  let session = (await login(out)).body.refreshToken;
  let res = await request(s).post('/auth/logout').send({ refreshToken: 'garbage', deviceToken: phone });
  check('a made-up session', res.status, 200);
  check('  removes nothing', await ownerOf(phone), out.id);
  const other = await mk();
  const otherSession = (await login(other)).body.refreshToken;
  await request(s).post('/auth/logout').send({ refreshToken: otherSession, deviceToken: phone });
  check('someone else\'s session removes nothing', await ownerOf(phone), out.id);
  await request(s).post('/auth/logout').send({ refreshToken: session, deviceToken: { a: 1 } });
  check('a token that isn\'t text is ignored', await ownerOf(phone), out.id);
  session = (await login(out)).body.refreshToken;
  res = await request(s).post('/auth/logout').send({ refreshToken: session, deviceToken: phone });
  check('real sign out', res.status, 200);
  check('  this phone stops getting notifications', await ownerOf(phone), null);
  const kept = token();
  await register(out, kept);
  session = (await login(out)).body.refreshToken;
  await request(s).post('/auth/logout').send({ refreshToken: session });
  check('older apps that don\'t send it still sign out', await ownerOf(kept), out.id);
  const another = token();
  await register(out, another);
  session = (await login(out)).body.refreshToken;
  await request(s).post('/auth/logout').send({ refreshToken: session, deviceToken: another });
  check('other devices of theirs keep theirs', await ownerOf(kept), out.id);

  console.log('--- an intruder\'s phone after the owner takes back the account');
  const fp = (mod.get(AuthService) as any).passwordFingerprint(hash);

  const resetVictim = await mk();
  const intruder1 = token();
  await register(resetVictim, intruder1);
  const reset = await request(s).post('/auth/reset-password').send({ token: jwt.sign({ id: resetVictim.id, pwd: fp }, process.env.RESET_PASSWORD_SECRET!), password: 'brand-new-password', confirmPassword: 'brand-new-password' });
  check('forgot password', reset.status < 300, true);
  check('  removes it', await ownerOf(intruder1), null);

  const changeVictim = await mk();
  const intruder2 = token();
  await register(changeVictim, intruder2);
  const keep = (await login(changeVictim)).body.refreshToken;
  const change = await request(s).post('/auth/change-password').set(changeVictim.h).send({ password: PASSWORD, newPassword: 'brand-new-password', confirmPassword: 'brand-new-password', refreshToken: keep });
  check('change password', change.status < 300, true);
  check('  removes it', await ownerOf(intruder2), null);
  const own = token();
  check('  the owner\'s phone can register again', (await register(changeVictim, own)).status, 201);

  const admin = await mk({ role: 'ADMIN' });
  const adminVictim = await mk();
  const intruder3 = token();
  await register(adminVictim, intruder3);
  check('admin reset', (await request(s).patch(`/admin/users/${adminVictim.id}`).set(admin.h).send({ password: 'brand-new-password' })).status, 200);
  check('  removes it', await ownerOf(intruder3), null);

  const preRegistered = await mk({ emailVerified: false });
  const intruder4 = token();
  await register(preRegistered, intruder4);
  await mod.get(UsersService).findOrCreateGoogleUser(preRegistered.email, 'Real Owner');
  check('real owner arriving through Google removes a squatter\'s phone', await ownerOf(intruder4), null);

  console.log('--- removing a device directly');
  const d1 = await mk();
  const d2 = await mk();
  const value = token();
  await register(d1, value);
  await request(s).delete(`/devices/${encodeURIComponent(value)}`).set(d2.h);
  check('someone else can\'t', await ownerOf(value), d1.id);
  await request(s).delete(`/devices/${encodeURIComponent(value)}`).set(d1.h);
  check('the owner can', await ownerOf(value), null);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
