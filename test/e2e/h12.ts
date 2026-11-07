// End-to-end check. Uses the REAL google-auth-library verification with really signed tokens:
// only the download of Google's public keys is replaced, by a key made here. Postgres is disposable.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
process.env.GOOGLE_CLIENT_ID = 'our-client-id.apps.googleusercontent.com';
delete process.env.GOOGLE_WEB_CLIENT_ID;
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('refusing to run outside the throwaway database');

const P = require('path').resolve(__dirname, '../..');
const R = `${P}/src`;
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'crypto';
import { OAuth2Client } from 'google-auth-library';

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
  const google = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const attacker = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(require('@nestjs/throttler').ThrottlerStorage).useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
    .overrideProvider(EmailService).useValue({ sendEmail: async () => ({}) })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.init();
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P);

  // The real client doing the real checks; only where it fetches Google's keys from is replaced
  const client = new OAuth2Client();
  (client as any).getFederatedSignonCertsAsync = async () => ({ certs: { k1: google.publicKey } });
  (mod.get(AuthService) as any).googleClient = client;

  const token = (over: any = {}, key: string = google.privateKey) => {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      { iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub: '123', email: 'owner@gmail.com', email_verified: true, name: 'Owner', iat: now, exp: now + 3000, ...over },
      key,
      { algorithm: 'RS256', keyid: 'k1' },
    );
  };
  const signIn = (idToken: any) => request(s).post('/auth/google/mobile').send({ idToken });

  console.log('--- the attack: a real Google token issued to some other app');
  let r = await signIn(token({ aud: 'some-other-app.apps.googleusercontent.com', email: 'victim@gmail.com' }));
  check('token for another app refused', r.status, 401);
  check('  no account created', await db.user.count({ where: { email: 'victim@gmail.com' } }), 0);
  check('  message reveals nothing', r.body.message, 'Google sign-in failed');

  console.log('--- real sign-ins');
  r = await signIn(token());
  check('token for this app accepted', r.status, 201);
  check('  returns tokens', !!r.body.accessToken && !!r.body.refreshToken, true);

  console.log('--- a separate mobile client is opt-in');
  check('other client refused by default', (await signIn(token({ aud: 'mobile-client' }))).status, 401);
  process.env.GOOGLE_WEB_CLIENT_ID = 'mobile-client';
  check('accepted once configured', (await signIn(token({ aud: 'mobile-client' }))).status, 201);
  check('main client still accepted', (await signIn(token())).status, 201);
  check('others still refused', (await signIn(token({ aud: 'somebody-else' }))).status, 401);
  delete process.env.GOOGLE_WEB_CLIENT_ID;

  console.log('--- other bad tokens get a 401 (were 500s)');
  check('signed by the wrong key', (await signIn(token({}, attacker.privateKey))).status, 401);
  const now = Math.floor(Date.now() / 1000);
  check('expired', (await signIn(token({ iat: now - 7200, exp: now - 3600 }))).status, 401);
  check('wrong issuer', (await signIn(token({ iss: 'https://evil.example' }))).status, 401);
  check('garbage', (await signIn('garbage')).status, 401);
  check('Google email not verified', (await signIn(token({ email_verified: false }))).status, 401);

  console.log('--- bad requests');
  check('missing token', (await signIn(undefined)).status, 400);
  check('empty token', (await signIn('')).status, 400);
  check('wrong type', (await signIn({ a: 1 })).status, 400);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
