// End-to-end check against a disposable Postgres container. Real AppModule and real Prisma;
// email is stubbed and Google's token check is replaced.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.REFRESH_TOKEN_SECRET = 'audit-refresh';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
process.env.GOOGLE_CLIENT_ID = 'x';
process.env.GOOGLE_CLIENT_SECRET = 'x';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost/cb';
process.env.GOOGLE_WEB_CLIENT_ID = 'x';
process.env.RESEND_API_KEY = 're_fake';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('refusing to run outside the throwaway database');

const P = require('path').resolve(__dirname, '../..');
const R = `${P}/src`;
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import * as cookieParser from 'cookie-parser';

const { AppModule } = require(`${R}/app.module`);
const { DatabaseService } = require(`${R}/database/database.service`);
const { EmailService } = require(`${R}/email/email.service`);
const { AuthService } = require(`${R}/auth/auth.service`);
const { GoogleStrategy } = require(`${R}/auth/google.strategy`);

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
  app.use(cookieParser());
  await app.init();
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P); // renderTemplate reads templates/ relative to cwd

  // Stands in for Google: the "token" is just the payload it would have verified
  (mod.get(AuthService) as any).googleClient = {
    verifyIdToken: async ({ idToken }: any) => ({ getPayload: () => JSON.parse(idToken) }),
  };
  const strategy = mod.get(GoogleStrategy);

  const webGoogle = (email: string, verified: any = true) =>
    strategy.validate('', '', { emails: [{ value: email, verified }], displayName: 'Real Owner' });
  const mobileGoogle = (email: string, email_verified = true) =>
    request(s).post('/auth/google/mobile').send({ idToken: JSON.stringify({ email, email_verified, name: 'Real Owner' }) });
  const register = (email: string, password: string) =>
    request(s).post('/auth/register').set('x-client', 'mobile').send({ name: 'Attacker', email, password, confirmPassword: password });
  const login = (email: string, password: string) => request(s).post('/auth/login').send({ email, password });
  const row = (email: string) => db.user.findUnique({ where: { email }, omit: { password: false } });
  const verifiedUser = (email: string, password: string, provider = 'local') =>
    bcrypt.hash(password, 4).then((hash) => db.user.create({ data: { name: 'V', email, password: hash, provider, emailVerified: true } }));

  console.log('--- the attack, through the web flow');
  let r = await register('victim@gmail.com', 'attacker-pass');
  check('attacker registers the email', r.status, 201);
  const attackerId = r.body.user.id;
  const attackerRefresh = r.body.refreshToken;
  check('attacker can log in', (await login('victim@gmail.com', 'attacker-pass')).status, 200);
  const signedIn = await webGoogle('victim@gmail.com');
  check('owner signs in with Google, same account', signedIn.id, attackerId);
  let u = await row('victim@gmail.com');
  check('password removed', u.password, null);
  check('email now verified', u.emailVerified, true);
  check('provider is google, so clients hide the password form', u.provider, 'google');
  check("attacker's password no longer works", (await login('victim@gmail.com', 'attacker-pass')).status, 401);
  check('login response hides password', JSON.stringify(signedIn).includes('$2b$'), false);

  console.log('--- the attack, through the mobile flow');
  r = await register('victim2@gmail.com', 'attacker-pass');
  const id2 = r.body.user.id;
  r = await mobileGoogle('victim2@gmail.com');
  check('owner signs in with Google', r.status, 201);
  check('  gets tokens for the same account', (jwt.decode(r.body.accessToken) as any).id, id2);
  check('password removed', (await row('victim2@gmail.com')).password, null);
  check("attacker's password no longer works", (await login('victim2@gmail.com', 'attacker-pass')).status, 401);

  console.log('--- real accounts keep working');
  await verifiedUser('verified@gmail.com', 'own-pass');
  r = await mobileGoogle('verified@gmail.com');
  check('verified user signs in with Google', r.status, 201);
  check('  password kept', (await login('verified@gmail.com', 'own-pass')).status, 200);
  check('  provider unchanged', (await row('verified@gmail.com')).provider, 'local');
  await webGoogle('verified@gmail.com');
  check('  still kept after web flow', (await login('verified@gmail.com', 'own-pass')).status, 200);
  await verifiedUser('setown@gmail.com', 'own-pass', 'google');
  await webGoogle('setown@gmail.com');
  check('Google user who set a password keeps it', (await login('setown@gmail.com', 'own-pass')).status, 200);
  const n = await db.user.count();
  await webGoogle('verified@gmail.com');
  await mobileGoogle('VERIFIED@Gmail.com');
  check('capitalized email finds the same account (no duplicate)', await db.user.count(), n);

  console.log('--- new Google users');
  const fresh = await webGoogle('New@Gmail.com');
  check('web: created lowercase', fresh.email, 'new@gmail.com');
  check('web: no password', (await row('new@gmail.com')).password, null);
  r = await mobileGoogle('new2@gmail.com');
  check('mobile: created', r.status, 201);
  check('mobile: verified', (await row('new2@gmail.com')).emailVerified, true);

  console.log('--- Google says the email is not verified');
  const web = async (profile: any) => {
    try {
      await strategy.validate('', '', profile);
      return 'accepted';
    } catch (e: any) {
      return e.status;
    }
  };
  await register('unverifiedgoogle@gmail.com', 'attacker-pass');
  check('web: verified=false', await web({ emails: [{ value: 'unverifiedgoogle@gmail.com', verified: false }], displayName: 'X' }), 401);
  check('web: verified missing', await web({ emails: [{ value: 'unverifiedgoogle@gmail.com' }], displayName: 'X' }), 401);
  check('web: no email at all (was a crash)', await web({ displayName: 'X' }), 401);
  check('mobile: rejected', (await mobileGoogle('unverifiedgoogle@gmail.com', false)).status, 401);
  check('  account untouched', (await row('unverifiedgoogle@gmail.com')).password !== null, true);
  check('  still unverified', (await row('unverifiedgoogle@gmail.com')).emailVerified, false);
  check('web: verified sent as a string works', (await webGoogle('stringflag@gmail.com', 'true')).email, 'stringflag@gmail.com');

  console.log('--- the owner can still get a password back');
  const token = jwt.sign({ id: attackerId, pwd: (mod.get(AuthService) as any).passwordFingerprint((await db.user.findUnique({ where: { id: attackerId }, omit: { password: false } })).password) }, process.env.RESET_PASSWORD_SECRET!);
  check('reset password', (await request(s).post('/auth/reset-password').send({ token, password: 'owner-pass', confirmPassword: 'owner-pass' })).status, 201);
  check('  owner logs in with it', (await login('victim@gmail.com', 'owner-pass')).status, 200);

  console.log('--- the previous holder loses their sessions');
  r = await request(s).post('/auth/refresh').send({ refreshToken: attackerRefresh });
  check("attacker's refresh token from before the takeover", r.status, 403);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
