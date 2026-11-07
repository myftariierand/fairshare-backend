// End-to-end check, from the point of view of someone probing for registered emails.
// The real app and real bcrypt; only email delivery is replaced, with a realistic delay. Postgres is disposable.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('refusing to run outside the throwaway database');

const P = require('path').resolve(__dirname, '../..');
const R = `${P}/src`;
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let unhandled = 0;
process.on('unhandledRejection', () => { unhandled++; });

(async () => {
  const sent: { to: string; subject: string; html: string; text: string }[] = [];
  let emailFails = false;
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(require('@nestjs/throttler').ThrottlerStorage).useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
    .overrideProvider(EmailService).useValue({
      sendEmail: async (e: any) => {
        await sleep(300);
        if (emailFails) throw new Error('email provider down');
        sent.push(e);
        return {};
      },
    })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.listen(0);
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P);

  const hash = await bcrypt.hash('correct-password', 10);
  const mk = (email: string, extra: any = {}) => db.user.create({ data: { name: email, email, password: hash, ...extra } });
  const known = await mk('known@test.dev');
  await mk('admin@test.dev', { role: 'ADMIN' });
  await mk('google@test.dev', { password: null, provider: 'google' });

  const shape = (r: any) => `${r.status} ${JSON.stringify(r.body)}`;
  const median = async (fn: () => any, n = 7) => {
    const t: number[] = [];
    for (let i = 0; i < n; i++) {
      const start = process.hrtime.bigint();
      await fn();
      t.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    return t.sort((a, b) => a - b)[Math.floor(n / 2)];
  };
  const post = (url: string, body: any) => request(s).post(url).send(body);
  const sameTime = (name: string, a: number, b: number) => {
    const ratio = Math.min(a, b) / Math.max(a, b);
    console.log(`      ${name}: ${a.toFixed(1)} ms vs ${b.toFixed(1)} ms`);
    // Medians of about 1 ms differ by a large ratio from noise alone. A real leak is the 35 ms hash or
    // the 300 ms email, so a small gap passes whatever the ratio.
    check(`  ${name} takes about as long`, ratio > 0.6 || Math.abs(a - b) < 15, true);
  };

  for (const [label, url] of [['login', '/auth/login'], ['admin login', '/auth/admin/login']]) {
    console.log(`--- ${label}: is this email registered?`);
    const login = (email: string, password = 'wrong-password') => post(url, { email, password });
    const unknownR = await login('nobody@test.dev');
    const knownR = await login('known@test.dev');
    const googleR = await login('google@test.dev');
    console.log(`      unknown: ${shape(unknownR)}`);
    check('unknown email and wrong password look the same', shape(unknownR), shape(knownR));
    check('account with no password looks the same', shape(googleR), shape(knownR));
    check('  and it is a 401', unknownR.status, 401);
    sameTime('unknown vs wrong password', await median(() => login('nobody@test.dev')), await median(() => login('known@test.dev')));
    sameTime('no password vs wrong password', await median(() => login('google@test.dev')), await median(() => login('known@test.dev')));
  }

  console.log('--- login still works');
  check('right password', (await post('/auth/login', { email: 'known@test.dev', password: 'correct-password' })).status, 200);
  const adminOk = await post('/auth/admin/login', { email: 'admin@test.dev', password: 'correct-password' });
  check('admin login', adminOk.status < 300, true);

  console.log('--- forgot password');
  sent.length = 0;
  const forgot = (email: string) => post('/auth/forgot-password', { email });
  const unknownF = await forgot('nobody@test.dev');
  check('same answer', shape(unknownF), shape(await forgot('known@test.dev')));
  sameTime('unknown vs known', await median(() => forgot('nobody@test.dev')), await median(() => forgot('known@test.dev')));
  await sleep(500);
  const reset = sent.find((e) => e.to === 'known@test.dev');
  check('email still arrives', !!reset, true);
  check('nothing sent to unknown address', sent.some((e) => e.to === 'nobody@test.dev'), false);
  const token = reset?.html.replace(/&#x3D;/g, '=').match(/token=([\w.-]+)/)?.[1];
  const resetR = await post('/auth/reset-password', { token, password: 'brand-new-password', confirmPassword: 'brand-new-password' });
  check('and the link in it works', resetR.status < 300, true);
  emailFails = true;
  check('email outage looks the same', shape(await forgot('known@test.dev')), shape(unknownF));
  await sleep(500);
  emailFails = false;

  console.log('--- sending a verification code');
  sent.length = 0;
  const sendCode = (email: string) => post('/auth/verify-email/send', { email });
  const unknownS = await sendCode('nobody@test.dev');
  await mk('fresh@test.dev');
  const firstS = await sendCode('fresh@test.dev');
  check('first send looks the same', shape(firstS), shape(unknownS));
  const coolS = await sendCode('fresh@test.dev');
  check('send during cooldown looks the same', shape(coolS), shape(unknownS));
  await sleep(500);
  check('cooldown still limits to one email', sent.filter((e) => e.to === 'fresh@test.dev').length, 1);
  await mk('burst@test.dev');
  await Promise.all(Array.from({ length: 8 }, () => sendCode('burst@test.dev')));
  await sleep(500);
  check('eight requests at once send one email', sent.filter((e) => e.to === 'burst@test.dev').length, 1);
  const burstOtp = await db.emailVerificationOtp.count({ where: { user: { email: 'burst@test.dev' } } });
  check('  and leave one code', burstOtp, 1);
  await mk('timing@test.dev');
  await mk('timing2@test.dev');
  const unknownT = await median(() => sendCode('nobody@test.dev'));
  const firstStart = process.hrtime.bigint();
  await sendCode('timing@test.dev');
  sameTime('unknown vs a first send', unknownT, Math.max(Number(process.hrtime.bigint() - firstStart) / 1e6, 0.1));
  emailFails = true;
  check('email outage looks the same', shape(await sendCode('timing2@test.dev')), shape(unknownS));
  await sleep(500);
  emailFails = false;
  await sendCode('timing2@test.dev');
  await sleep(500);
  check('after an outage the next request still sends a code', sent.filter((e) => e.to === 'timing2@test.dev').length, 1);

  console.log('--- checking a verification code');
  const verify = (email: string, otp: string) => post('/auth/verify-email/verify', { email, otp });
  const unknownV = await verify('nobody@test.dev', '000000');
  console.log(`      unknown: ${shape(unknownV)}`);
  check('account with no code looks the same', shape(await verify('known@test.dev', '000000')), shape(unknownV));
  check('wrong code looks the same', shape(await verify('fresh@test.dev', '000000')), shape(unknownV));
  for (let i = 0; i < 5; i++) await verify('fresh@test.dev', '000000');
  check('locked out by too many guesses looks the same', shape(await verify('fresh@test.dev', '000000')), shape(unknownV));
  const firstCode = sent.find((e) => e.to === 'fresh@test.dev')?.text.match(/\d{6}/)?.[0] as string;
  check('the right code no longer works once locked', (await verify('fresh@test.dev', firstCode)).body.verified, false);

  console.log('--- getting out of a lockout');
  const freshUser = await db.user.findUnique({ where: { email: 'fresh@test.dev' } });
  await db.$executeRaw`UPDATE "EmailVerificationOtp" SET "updatedAt" = now() - interval '2 minutes' WHERE "userId" = ${freshUser.id}`;
  sent.length = 0;
  await sendCode('fresh@test.dev');
  await sleep(500);
  const secondCode = sent.find((e) => e.to === 'fresh@test.dev')?.text.match(/\d{6}/)?.[0] as string;
  check('new code is sent', !!secondCode, true);
  check('new code verifies', (await verify('fresh@test.dev', secondCode)).body.verified, true);
  check('account is verified', (await db.user.findUnique({ where: { email: 'fresh@test.dev' } })).emailVerified, true);

  console.log('--- registering (left as it is, shown here so the gap is on record)');
  const dup = await post('/auth/register', { email: 'known@test.dev', name: 'x', password: 'long-enough-password', confirmPassword: 'long-enough-password' });
  console.log(`      taken email: ${shape(dup)}`);
  check('a taken email is still refused', dup.status, 403);

  check('no unhandled rejections', unhandled, 0);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
