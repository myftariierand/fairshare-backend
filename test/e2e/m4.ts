// End-to-end check. The real app and the real passport strategy; only the two network calls
// to Google (code exchange, profile fetch) are replaced. Postgres is disposable.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
process.env.GOOGLE_CLIENT_ID = 'our-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CALLBACK_URL = 'https://api.test/auth/google/callback';
process.env.CLIENT_ORIGIN = 'https://web.test';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('refusing to run outside the throwaway database');

const P = require('path').resolve(__dirname, '../..');
const R = `${P}/src`;
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';

const { AppModule } = require(`${R}/app.module`);
const { DatabaseService } = require(`${R}/database/database.service`);
const { EmailService } = require(`${R}/email/email.service`);
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
  app.use(cookieParser()); // main.ts does this in production
  await app.init();
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P); // email templates load relative to the repo, as in production

  // Each code stands for whichever Google account signed in to get it
  const strategy: any = mod.get(GoogleStrategy);
  let exchanges = 0;
  strategy._oauth2.getOAuthAccessToken = (code: string, _p: any, cb: any) => { exchanges++; cb(null, code, 'rt', {}); };
  strategy.userProfile = (accessToken: string, done: any) =>
    done(null, { displayName: accessToken, emails: [{ value: `${accessToken}@gmail.com`, verified: true }] });

  const cookiesOf = (r: any): string[] => r.headers['set-cookie'] ?? [];
  const stateCookie = (r: any) => cookiesOf(r).find((c) => c.startsWith('__Host-oauth_state='));
  const stateOf = (r: any) => new URL(r.headers.location).searchParams.get('state');
  const pairOf = (c?: string) => c?.split(';')[0] ?? '';
  const signedIn = (r: any) => cookiesOf(r).some((c) => c.startsWith('jwt=') && !c.startsWith('jwt=;'));
  const callback = (query: string, cookie?: string) => {
    const req = request(s).get(`/auth/google/callback?${query}`);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const refused = async (name: string, r: any, email: string) => {
    check(name, r.status, 401);
    check('  no session given', signedIn(r), false);
    check('  no account created', await db.user.count({ where: { email } }), 0);
  };

  console.log('--- the attack: a link carrying the attacker\'s own Google code, opened by a victim');
  let before = exchanges;
  await refused('callback with no state at all', await callback('code=attacker1'), 'attacker1@gmail.com');
  check('  code never sent to Google', exchanges, before);

  // The attacker can start a flow of their own to get a genuine state, but can't plant their cookie
  const attackerStart = await request(s).get('/auth/google');
  const attackerState = stateOf(attackerStart);
  await refused('attacker\'s genuine state, victim has no cookie', await callback(`code=attacker2&state=${attackerState}`), 'attacker2@gmail.com');

  const victimStart = await request(s).get('/auth/google');
  const victimCookie = pairOf(stateCookie(victimStart));
  await refused('attacker\'s genuine state, victim mid sign-in', await callback(`code=attacker3&state=${attackerState}`, victimCookie), 'attacker3@gmail.com');

  console.log('--- starting a sign-in');
  check('redirects to Google', victimStart.status, 302);
  check('  to the real Google page', new URL(victimStart.headers.location).hostname, 'accounts.google.com');
  check('  state sent is the one in the cookie', `__Host-oauth_state=${stateOf(victimStart)}`, victimCookie);
  check('  state is long enough', (stateOf(victimStart) ?? '').length >= 40, true);
  const attrs = (stateCookie(victimStart) ?? '').toLowerCase();
  check('  cookie is HttpOnly', attrs.includes('httponly'), true);
  check('  cookie is Secure', attrs.includes('secure'), true);
  check('  cookie is SameSite=Lax, which survives the return from Google', attrs.includes('samesite=lax'), true);
  check('  cookie is host-only', attrs.includes('domain='), false);
  check('  cookie expires', attrs.includes('max-age=600'), true);
  const other = await request(s).get('/auth/google');
  check('  each sign-in gets a new state', stateOf(other) === stateOf(victimStart), false);

  console.log('--- the web login button, which links straight at the callback');
  const webStart = await request(s).get('/auth/google/callback');
  check('still starts a sign-in', webStart.status, 302);
  check('  to the real Google page', new URL(webStart.headers.location).hostname, 'accounts.google.com');
  check('  with a state', !!stateOf(webStart), true);

  console.log('--- malformed returns');
  const st = stateOf(victimStart);
  await refused('cookie but no state in the URL', await callback('code=bad1', victimCookie), 'bad1@gmail.com');
  await refused('state sent twice', await callback(`code=bad2&state=${st}&state=${st}`, victimCookie), 'bad2@gmail.com');
  await refused('empty state and empty cookie', await callback('code=bad3&state=', '__Host-oauth_state='), 'bad3@gmail.com');
  await refused('different length state', await callback('code=bad4&state=abc', victimCookie), 'bad4@gmail.com');

  console.log('--- a real sign-in');
  const done = await callback(`code=owner&state=${st}`, victimCookie);
  check('succeeds', done.status, 302);
  check('  sent back to the web app', done.headers.location, 'https://web.test');
  check('  session given', signedIn(done), true);
  check('  account created', await db.user.count({ where: { email: 'owner@gmail.com' } }), 1);
  check('  state cookie removed, so it works once', /^__Host-oauth_state=;/.test(stateCookie(done) ?? ''), true);
  const jwtCookie = cookiesOf(done).find((c) => c.startsWith('jwt=')) ?? '';
  const refreshed = await request(s).get('/auth/refresh').set('Cookie', pairOf(jwtCookie));
  check('  the session works', refreshed.status < 300, true);

  console.log('--- after a refused attempt');
  const failed = await callback('code=bad5&state=wrong', pairOf(stateCookie(other)));
  check('state cookie removed there too', /^__Host-oauth_state=;/.test(stateCookie(failed) ?? ''), true);

  console.log('--- cancelling on Google\'s page');
  const denied = await callback('error=access_denied');
  check('no session', signedIn(denied), false);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
