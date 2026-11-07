// End-to-end check against a disposable Postgres container, with the real rate limits on.
// Email is stubbed but counted.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.REFRESH_TOKEN_SECRET = 'audit-refresh';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
process.env.GOOGLE_CLIENT_ID = 'x';
process.env.GOOGLE_CLIENT_SECRET = 'x';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost/cb';
process.env.RESEND_API_KEY = 're_fake';
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
  let emails = 0;
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService).useValue({ sendEmail: async () => { emails++; return {}; } })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.init();
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P);

  const mkUser = async (name: string) => {
    const u = await db.user.create({ data: { name, email: `${name}@test.dev`, password: await bcrypt.hash('right', 4) } });
    return { id: u.id, email: u.email, h: { Authorization: `Bearer ${jwt.sign({ id: u.id }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const alice = await mkUser('alice');
  const bob = await mkUser('bob');

  const hit = async (n: number, f: () => any) => {
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) statuses.push((await f()).status);
    return statuses;
  };
  const count = (list: number[], status: number) => list.filter((x) => x === status).length;
  const login = (ip: string, password = 'wrong', email = alice.email) =>
    request(s).post('/auth/login').set('X-Real-IP', ip).send({ email, password });

  console.log('--- password guessing');
  let r = await hit(15, () => login('1.1.1.1'));
  check('first 10 attempts reach the password check', count(r, 401), 10);
  check('the rest are refused', count(r, 429), 5);
  const blocked = await login('1.1.1.1');
  check('says so in words', blocked.body.message, 'Too many requests. Please try again shortly.');
  check('tells the client when to retry', Number(blocked.headers['retry-after']) > 0, true);
  check('a blocked IP cannot log in even with the right password', (await login('1.1.1.1', 'right')).status, 429);
  check('a different IP is unaffected', (await login('2.2.2.2', 'right')).status, 200);

  console.log('--- the real client IP is what counts');
  r = await hit(11, () => request(s).post('/auth/login').set('X-Real-IP', '3.3.3.3').set('X-Forwarded-For', `9.9.9.${Math.random() * 200 | 0}`).send({ email: alice.email, password: 'wrong' }));
  check('changing X-Forwarded-For gets around nothing', count(r, 429), 1);
  check('admin login is stricter', count(await hit(7, () => request(s).post('/auth/admin/login').set('X-Real-IP', '4.4.4.4').send({ email: alice.email, password: 'wrong' })), 429), 2);

  console.log('--- password reset emails');
  emails = 0;
  r = await hit(5, () => request(s).post('/auth/forgot-password').set('X-Real-IP', `5.5.5.${Math.random() * 200 | 0}`).send({ email: alice.email }));
  check('3 per email, even from different IPs', count(r, 429), 2);
  check('only 3 emails actually sent', emails, 3);
  r = await hit(2, () => request(s).post('/auth/forgot-password').set('X-Real-IP', '5.5.6.1').send({ email: ' ALICE@test.dev ' }));
  check('capitalization and spaces get around nothing', count(r, 429), 2);
  check('another person is unaffected', (await request(s).post('/auth/forgot-password').set('X-Real-IP', '5.5.6.2').send({ email: bob.email })).status, 201);
  r = await hit(7, () => request(s).post('/auth/forgot-password').set('X-Real-IP', '5.5.7.1').send({ email: `nobody${Math.random()}@test.dev` }));
  check('5 per IP across different emails', count(r, 429), 2);

  console.log('--- verification codes');
  const otpUser = await mkUser('otp');
  r = await hit(12, () => request(s).post('/auth/verify-email/verify').set('X-Real-IP', `6.6.6.${Math.random() * 200 | 0}`).send({ email: otpUser.email, otp: '000000' }));
  check('10 guesses per account, even from different IPs', count(r, 429), 2);

  console.log('--- logged-in users are counted by account');
  r = await hit(32, () => request(s).get('/users/search').set(alice.h).set('X-Real-IP', '7.7.7.7').query({ query: 'bob' }));
  check('search is limited', count(r, 429), 2);
  check('someone else on the same network is unaffected', (await request(s).get('/users/search').set(bob.h).set('X-Real-IP', '7.7.7.7').query({ query: 'alice' })).status, 200);
  check('alice is still fine elsewhere', (await request(s).get('/groups').set(alice.h)).status, 200);
  check('bug reports limited', count(await hit(6, () => request(s).post('/bug-reports').set(bob.h).send({ title: 'abc', description: 'long enough text' })), 429), 1);

  console.log('--- normal use is not limited');
  const carol = await mkUser('carol');
  r = await hit(120, () => request(s).get('/groups').set(carol.h));
  check('120 ordinary requests in a burst', count(r, 200), 120);
  r = await hit(30, () => request(s).post('/auth/refresh').set('X-Real-IP', '8.8.8.8').send({ refreshToken: 'x' }));
  check('refresh allows a shared network', count(r, 429), 0);
  check('other routes have their own count', (await request(s).get('/friends').set(carol.h)).status, 200);

  console.log('--- a general limit covers everything else');
  const dave = await mkUser('dave');
  const results: number[] = [];
  for (let i = 0; i < 301; i++) results.push((await request(s).get('/friends').set(dave.h)).status);
  check('301st request refused', results[300], 429);
  check('300th allowed', results[299], 200);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
