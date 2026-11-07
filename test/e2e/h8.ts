// End-to-end check against a disposable Postgres container. Real AppModule and real Prisma;
// email is stubbed.
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
  await app.init();
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P);

  const mk = async (name: string, email: string, role = 'USER') => {
    const u = await db.user.create({ data: { name, email, role, password: null } });
    return { id: u.id, email, h: { Authorization: `Bearer ${jwt.sign({ id: u.id, ...(role === 'ADMIN' ? { role } : {}) }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const me = await mk('Searcher', 'searcher@test.dev');
  const john = await mk('John Smith', 'john.smith@gmail.com');
  await mk('Johanna Lee', 'jl@gmail.com');
  await mk('Zed', 'zed@outlook.com');
  const admin = await mk('Johnny Admin', 'johnny@admin.dev', 'ADMIN');

  const search = (q: string, extra: any = {}, u = me) => request(s).get('/users/search').set(u.h).query({ query: q, ...extra });
  const emails = (r: any) => r.body.map((x: any) => x.email).sort().join(',');
  const names = (r: any) => r.body.map((x: any) => x.name).sort().join(',');

  console.log('--- removed routes');
  check('GET /users', (await request(s).get('/users').set(me.h)).status, 404);
  check('GET /users/:id', (await request(s).get(`/users/${john.id}`).set(me.h)).status, 404);
  check('GET /bug-reports', (await request(s).get('/bug-reports').set(me.h)).status, 404);

  console.log('--- bug reports');
  let r = await request(s).post('/bug-reports').set(me.h).send({ title: 'abc', description: 'long enough text', email: 'reporter@test.dev' });
  check('users can still report a bug', r.status, 201);
  check('admins can read them', (await request(s).get('/admin/bugs').set(admin.h)).body.length, 1);
  check('users cannot', (await request(s).get('/admin/bugs').set(me.h)).status, 403);

  console.log('--- short queries list nobody');
  check('empty', (await search('')).body.length, 0);
  check('spaces', (await search('   ')).body.length, 0);
  check('one letter', (await search('j')).body.length, 0);
  check('login still required', (await request(s).get('/users/search').query({ query: 'john' })).status, 401);

  console.log('--- finding people');
  r = await search('jo');
  check('by part of a name', names(r), 'Johanna Lee,John Smith');
  check('name in the middle, any case', names(await search('SMITH')), 'John Smith');
  check('by start of an email', names(await search('zed@')), 'Zed');
  check('never finds yourself', (await search('searcher')).body.length, 0);
  check('never finds admins', names(await search('johnny')), '');

  console.log('--- no listing by domain');
  check('@gmail.com', (await search('@gmail.com')).body.length, 0);
  check('gmail', (await search('gmail')).body.length, 0);
  check('.com', (await search('.com')).body.length, 0);

  console.log('--- only safe fields, emails masked');
  r = await search('john');
  check('email masked', r.body[0].email, 'j***@gmail.com');
  check('real email nowhere in the response', r.text.includes('john.smith'), false);
  const fields = Object.keys(r.body[0]).sort().join(',');
  check('fields', fields, 'email,friendshipsReceiver,id,name');
  r = await search('john.smith@gmail.com');
  check('full address typed: shown in full', r.body[0]?.email, 'john.smith@gmail.com');
  r = await search('JOHN.SMITH@GMAIL.COM');
  check('  any capitalization', r.body[0]?.email, 'john.smith@gmail.com');
  r = await search('john.smith@gmail.co');
  check('one letter short: still masked', r.body[0]?.email, 'j***@gmail.com');

  console.log('--- friend status still drives the buttons');
  await db.friendships.create({ data: { senderId: me.id, receiverId: john.id } });
  r = await search('john');
  check('pending request shown', r.body[0].friendshipsReceiver[0]?.status, 'PENDING');
  check('  to the sender only', (await search('john', {}, await mk('Other', 'other@test.dev'))).body[0].friendshipsReceiver.length, 0);

  console.log("--- invite status needs membership of that group");
  const G = (await request(s).post('/groups').set(me.h).field('name', 'G').field('currency', 'EUR')).body.id;
  await request(s).post(`/groups/${G}/invite/${john.id}`).set(me.h);
  r = await search('john', { groupId: G });
  check('member sees invite status', r.body[0].invitationReceiver[0]?.status, 'PENDING');
  const out = await mk('Outsider', 'outsider@test.dev');
  r = await search('john', { groupId: G }, out);
  check('non-member gets a normal answer', r.status, 200);
  check('  with no invite data', r.body[0].invitationReceiver, undefined);
  r = await search('john');
  check('no group given', r.body[0].invitationReceiver, undefined);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
