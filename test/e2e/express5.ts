// End-to-end check of what Express 5 changes: requests with no body and query parsing. The real
// app and database; only email is replaced. Postgres is disposable.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
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
  await app.listen(0);
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P);

  let n = 0;
  const mk = async () => {
    const u = await db.user.create({ data: { name: `U${++n}`, email: `u${n}@test.dev`, emailVerified: true } });
    return { ...u, h: { Authorization: `Bearer ${jwt.sign({ id: u.id }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const a = await mk();
  const group = await db.group.create({ data: { name: 'Trip', currency: 'EUR', createdById: a.id, members: { create: [{ userId: a.id }] } } });

  console.log('--- no body: every optional field still counts as missing, not as a bad request');
  const task = await request(s).post(`/groups/${group.id}/tasks`).set(a.h).send({ text: 'Book' });
  check('task created', task.status, 201);
  check('task update with no body', (await request(s).patch(`/groups/${group.id}/tasks/${task.body.id}`).set(a.h)).status, 200);
  check('task update with a type we do not parse', (await request(s).patch(`/groups/${group.id}/tasks/${task.body.id}`).set(a.h).set('Content-Type', 'text/plain').send('hello')).status, 200);
  const google = await mk();
  check('account without a password deletes with no body', (await request(s).post('/auth/delete-account').set(google.h)).status, 200);
  check('  gone', await db.user.count({ where: { id: google.id, deletedAt: null } }), 0);

  console.log('--- no body: required fields are still refused');
  check('login', (await request(s).post('/auth/login')).status, 400);
  const emptyLogin = await request(s).post('/auth/login');
  check('  names the missing field', JSON.stringify(emptyLogin.body).includes('email'), true);
  check('task create', (await request(s).post(`/groups/${group.id}/tasks`).set(a.h)).status, 400);
  check('settle', (await request(s).post('/transactions/settle').set(a.h)).status, 400);

  console.log("--- no body: @Body('refreshToken') handlers");
  check('refresh', (await request(s).post('/auth/refresh')).status, 403);
  check('logout', (await request(s).post('/auth/logout')).status, 204);
  check('refresh with an unknown token', (await request(s).post('/auth/refresh').send({ refreshToken: 'nope' })).status, 403);
  check('email throttle route with no body', (await request(s).post('/auth/forgot-password')).status, 400);

  console.log('--- bodies are still parsed');
  check('form body', (await request(s).post('/auth/forgot-password').type('form').send({ email: 'someone@test.dev' })).status, 201);
  check('malformed JSON', (await request(s).post('/auth/login').set('Content-Type', 'application/json').send('{"email":')).status, 400);

  console.log('--- query parsing');
  check('value', (await request(s).get('/activity-logs?page=2').set(a.h)).status, 200);
  check('bad value', (await request(s).get('/activity-logs?page=abc').set(a.h)).status, 400);
  check('bracket key is ignored, not nested', (await request(s).get('/activity-logs?page[x]=1').set(a.h)).status, 200);
  check('search with several values', (await request(s).get('/users/search?query=U1&limit=1&offset=0').set(a.h)).status, 200);
  check('required value', (await request(s).get('/auth/verify-reset-token')).status, 400);
  check('bracket key does not fill a required value', (await request(s).get('/auth/verify-reset-token?token[a]=b')).status, 400);
  check('repeated value', (await request(s).get('/auth/verify-reset-token?token=a&token=b')).status, 400);
  check('SSE ticket as a bracket key', (await request(s).get('/sse/subscribe?ticket[a]=b')).status, 401);
  check('SSE ticket repeated', (await request(s).get('/sse/subscribe?ticket=a&ticket=b')).status, 401);

  console.log('--- routes');
  check('unknown route', (await request(s).get('/nope').set(a.h)).status, 404);
  check('id in a path reaches the guard', (await request(s).patch(`/groups/not-a-uuid/tasks/${task.body.id}`).set(a.h).send({ done: true })).status, 403);
  check('valid path and body', (await request(s).patch(`/groups/${group.id}/tasks/${task.body.id}`).set(a.h).send({ done: true })).status, 200);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
