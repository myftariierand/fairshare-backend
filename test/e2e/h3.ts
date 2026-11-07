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
  process.chdir(P);

  let n = 0;
  const mkUser = async (role = 'USER') => {
    const email = `u${++n}@test.dev`;
    const u = await db.user.create({ data: { name: email, email, role, emailVerified: true, password: await bcrypt.hash('pass', 4) } });
    return { id: u.id, email };
  };
  const mobileLogin = async (u: any) => (await request(s).post('/auth/login').set('x-client', 'mobile').send({ email: u.email, password: 'pass' })).body;
  const refresh = (refreshToken: any) => request(s).post('/auth/refresh').send({ refreshToken });
  const ages = (ms: number) => new Date(Date.now() - ms);
  const expireGrace = () => db.refreshToken.updateMany({ where: { usedAt: { not: null } }, data: { usedAt: ages(2 * 60 * 1000) } });
  const cookieFrom = (r: any) => (r.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('jwt='));
  const cookieValue = (r: any) => cookieFrom(r)?.split(';')[0].slice(4);
  const works = async (t: string) => (await refresh(t)).status;
  const canUse = (access: string) => request(s).get('/groups').set({ Authorization: `Bearer ${access}` });

  console.log('--- rotation');
  let u = await mkUser();
  const first = await mobileLogin(u);
  check('login returns a token with session id', /^[0-9a-f-]{36}\./.test(first.refreshToken), true);
  check('only a hash is stored', await db.refreshToken.count({ where: { tokenHash: first.refreshToken } }), 0);
  let r = await refresh(first.refreshToken);
  check('refresh', r.status, 201);
  check('  returns a different token', r.body.refreshToken !== first.refreshToken, true);
  check('  access token works', (await canUse(r.body.accessToken)).status, 200);
  const second = r.body.refreshToken;
  r = await refresh(second);
  check('new token refreshes', r.status, 201);
  const third = r.body.refreshToken;

  console.log('--- two requests at once should not log anyone out');
  r = await refresh(second);
  check('just-used token inside the grace period', r.status, 201);
  const fresh = await mobileLogin(u);
  const results = await Promise.all(Array.from({ length: 6 }, () => refresh(fresh.refreshToken)));
  check('6 simultaneous refreshes all succeed', results.every((x) => x.status === 201), true);
  check('  session still works', (await refresh(results[3].body.refreshToken)).status, 201);

  console.log('--- theft: a used token shows up after the grace period');
  const victim = await mkUser();
  const phone = await mobileLogin(victim);
  const laptop = await mobileLogin(victim);
  r = await refresh(phone.refreshToken);
  const phoneNew = r.body.refreshToken;
  await expireGrace();
  check('stolen old token rejected', await works(phone.refreshToken), 403);
  check('  that session is ended', await works(phoneNew), 403);
  check('  other devices unaffected', await works(laptop.refreshToken), 201);

  console.log('--- theft: attacker rotated many times, victim comes back with an old token');
  const v2 = await mkUser();
  const stolen = (await mobileLogin(v2)).refreshToken;
  let attacker = stolen;
  for (let i = 0; i < 4; i++) {
    attacker = (await refresh(attacker)).body.refreshToken;
    await expireGrace();
  }
  check('old token row was pruned', await db.refreshToken.count({ where: { userId: v2.id } }) <= 2, true);
  check('victim comes back with the original token', await works(stolen), 403);
  check("  attacker's latest token dies too", await works(attacker), 403);

  console.log('--- table does not grow');
  const v3 = await mkUser();
  let t = (await mobileLogin(v3)).refreshToken;
  for (let i = 0; i < 30; i++) {
    t = (await refresh(t)).body.refreshToken;
    await expireGrace();
  }
  check('30 rotations leave at most 2 rows', await db.refreshToken.count({ where: { userId: v3.id } }) <= 2, true);
  check('  and still work', await works(t), 201);

  console.log('--- bad tokens');
  const legacy = jwt.sign({ id: u.id }, process.env.REFRESH_TOKEN_SECRET!);
  check('old-style JWT signed with the leaked secret', await works(legacy), 403);
  check('forged admin JWT', await works(jwt.sign({ id: u.id, role: 'ADMIN' }, process.env.REFRESH_TOKEN_SECRET!)), 403);
  check('missing', (await refresh(undefined)).status, 403);
  check('wrong type', (await refresh({ a: 1 })).status, 403);
  check('garbage', await works('garbage'), 403);
  check('access token', await works(first.accessToken), 403);
  check('no cookie on GET', (await request(s).get('/auth/refresh')).status, 403);
  const exp = await mobileLogin(u);
  await db.refreshToken.updateMany({ where: { userId: u.id }, data: { expiresAt: ages(1000) } });
  check('expired', await works(exp.refreshToken), 403);

  console.log('--- web: cookie flow');
  const w = await mkUser();
  r = await request(s).post('/auth/login').send({ email: w.email, password: 'pass' });
  check('login sets a cookie', !!cookieFrom(r), true);
  check('  httpOnly, secure, cross-site', /HttpOnly/.test(cookieFrom(r)!) && /Secure/.test(cookieFrom(r)!) && /SameSite=None/.test(cookieFrom(r)!), true);
  check('  token not in the body', r.body.refreshToken, undefined);
  const c1 = cookieValue(r);
  r = await request(s).get('/auth/refresh').set('Cookie', `jwt=${c1}`);
  check('GET refresh', r.status, 200);
  check('  sets a new cookie', !!cookieValue(r) && cookieValue(r) !== c1, true);
  check('  token not in the body', r.body.refreshToken, undefined);
  check('  returns access token', (await canUse(r.body.accessToken)).status, 200);
  r = await request(s).post('/auth/register').send({ name: 'n', email: 'reg@test.dev', password: 'password-1', confirmPassword: 'password-1' });
  check('register sets the same secure cookie', /Secure/.test(cookieFrom(r)!) && /SameSite=None/.test(cookieFrom(r)!), true);
  check('  and it refreshes', (await request(s).get('/auth/refresh').set('Cookie', `jwt=${cookieValue(r)}`)).status, 200);

  console.log('--- logout');
  const l = await mkUser();
  const l1 = await mobileLogin(l);
  const l2 = await mobileLogin(l);
  r = await request(s).post('/auth/logout').send({ refreshToken: l1.refreshToken });
  check('mobile logout with body', r.status, 200);
  check('  token dead', await works(l1.refreshToken), 403);
  check('  other device still logged in', await works(l2.refreshToken), 201);
  const wl = await mkUser();
  const wlr = await request(s).post('/auth/login').send({ email: wl.email, password: 'pass' });
  const wc = cookieValue(wlr);
  r = await request(s).post('/auth/logout').set('Cookie', `jwt=${wc}`);
  check('web logout with cookie', r.status, 200);
  check('  clears the cookie', /jwt=;/.test(cookieFrom(r) ?? ''), true);
  check('  token dead', (await request(s).get('/auth/refresh').set('Cookie', `jwt=${wc}`)).status, 403);
  check('logout with no token', (await request(s).post('/auth/logout')).status, 204);
  check('logout with garbage does not error', (await request(s).post('/auth/logout').send({ refreshToken: 'garbage' })).status, 200);
  const other = await mobileLogin(l);
  const sid = other.refreshToken.split('.')[0];
  await request(s).post('/auth/logout').send({ refreshToken: `${sid}.wrongsecret` });
  check('logout with a made-up secret ends nothing', await works(other.refreshToken), 201);

  console.log('--- password changes');
  const pc = await mkUser();
  const pcThis = await mobileLogin(pc);
  const pcOther = await mobileLogin(pc);
  const auth = (a: string) => ({ Authorization: `Bearer ${a}` });
  r = await request(s).post('/auth/change-password').set(auth(pcThis.accessToken)).send({ password: 'pass', newPassword: 'new-password-1', confirmPassword: 'new-password-1', refreshToken: pcThis.refreshToken });
  check('change password (mobile, with token)', r.status, 201);
  check('  this device stays logged in', await works(pcThis.refreshToken), 201);
  check('  other device logged out', await works(pcOther.refreshToken), 403);
  const pc2 = await mkUser();
  const pc2r = await request(s).post('/auth/login').send({ email: pc2.email, password: 'pass' });
  const pc2other = await mobileLogin(pc2);
  r = await request(s).post('/auth/change-password').set(auth(pc2r.body.accessToken)).set('Cookie', `jwt=${cookieValue(pc2r)}`).send({ password: 'pass', newPassword: 'new-password-1', confirmPassword: 'new-password-1' });
  check('change password (web, with cookie)', r.status, 201);
  check('  this browser stays logged in', (await request(s).get('/auth/refresh').set('Cookie', `jwt=${cookieValue(pc2r)}`)).status, 200);
  check('  other device logged out', await works(pc2other.refreshToken), 403);
  const pc3 = await mkUser();
  const pc3a = await mobileLogin(pc3);
  await request(s).post('/auth/change-password').set(auth(pc3a.accessToken)).send({ password: 'pass', newPassword: 'new-password-1', confirmPassword: 'new-password-1' });
  check('old app version sends no token: logged out, not stuck', await works(pc3a.refreshToken), 403);
  const pc4 = await mkUser();
  const pc4a = await mobileLogin(pc4);
  const stranger = await mobileLogin(await mkUser());
  await request(s).post('/auth/change-password').set(auth(pc4a.accessToken)).send({ password: 'pass', newPassword: 'new-password-2', confirmPassword: 'new-password-2', refreshToken: stranger.refreshToken });
  check("another user's token can't be used to keep a session", await works(stranger.refreshToken), 201);
  check('  own sessions still ended', await works(pc4a.refreshToken), 403);
  const rp = await mkUser();
  const rpa = await mobileLogin(rp);
  r = await request(s).post('/auth/reset-password').send({ token: jwt.sign({ id: rp.id, pwd: (mod.get(require(`${R}/auth/auth.service`).AuthService) as any).passwordFingerprint((await db.user.findUnique({ where: { id: rp.id }, omit: { password: false } })).password) }, process.env.RESET_PASSWORD_SECRET!), password: 'new-password-3', confirmPassword: 'new-password-3' });
  check('reset password', r.status, 201);
  check('  all sessions ended', await works(rpa.refreshToken), 403);

  console.log('--- admin');
  const ad = await mkUser('ADMIN');
  const al = await request(s).post('/auth/admin/login').send({ email: ad.email, password: 'pass' });
  check('admin login', al.status, 201);
  check('  access token has the role', (jwt.decode(al.body.accessToken) as any).role, 'ADMIN');
  r = await request(s).get('/auth/refresh').set('Cookie', `jwt=${cookieValue(al)}`);
  check('refresh keeps admin', (jwt.decode(r.body.accessToken) as any).role, 'ADMIN');
  check('  admin route works', (await request(s).get('/admin/bugs').set(auth(r.body.accessToken))).status, 200);
  const adCookie = cookieValue(r);
  await db.user.update({ where: { id: ad.id }, data: { role: 'USER' } });
  r = await request(s).get('/auth/refresh').set('Cookie', `jwt=${adCookie}`);
  check('demoted admin: refresh succeeds', r.status, 200);
  check('  but role is gone', (jwt.decode(r.body.accessToken) as any).role, undefined);
  check('  admin route refused', (await request(s).get('/admin/bugs').set(auth(r.body.accessToken))).status, 403);
  const ad2 = await mkUser('ADMIN');
  r = await refresh((await mobileLogin(ad2)).refreshToken);
  check('admin using normal login gets no admin access', (jwt.decode(r.body.accessToken) as any).role, undefined);
  const adminToken = jwt.sign({ id: ad2.id, role: 'ADMIN' }, process.env.ACCESS_TOKEN_SECRET!);
  const target = await mkUser();
  const targetT = await mobileLogin(target);
  check('admin sets a password', (await request(s).patch(`/admin/users/${target.id}`).set(auth(adminToken)).send({ password: 'admin-set-pass' })).status, 200);
  check('  user sessions ended', await works(targetT.refreshToken), 403);

  console.log('--- deleted users');
  const del = await mkUser();
  const delT = await mobileLogin(del);
  await db.user.delete({ where: { id: del.id } });
  check('refresh fails', await works(delT.refreshToken), 403);
  check('rows removed', await db.refreshToken.count({ where: { userId: del.id } }), 0);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
