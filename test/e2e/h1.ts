// Throwaway HTTP check of the event stream on a real socket. Real AppModule; Prisma and email stubbed,
// since the stream itself doesn't touch the database.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.REFRESH_TOKEN_SECRET = 'audit-refresh';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
process.env.GOOGLE_CLIENT_ID = 'x';
process.env.GOOGLE_CLIENT_SECRET = 'x';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost/cb';
process.env.RESEND_API_KEY = 're_fake';

const R = require('path').resolve(__dirname, '../../src');
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as http from 'http';
import * as jwt from 'jsonwebtoken';

const { AppModule } = require(`${R}/app.module`);
const { DatabaseService } = require(`${R}/database/database.service`);
const { EmailService } = require(`${R}/email/email.service`);
const { SseService } = require(`${R}/sse/sse.service`);

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const auth = (id: string) => ({ Authorization: `Bearer ${jwt.sign({ id }, process.env.ACCESS_TOKEN_SECRET!)}` });
const wait = (ms = 150) => new Promise((f) => setTimeout(f, ms));

(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(require('@nestjs/throttler').ThrottlerStorage).useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
    .overrideProvider(DatabaseService).useValue({})
    .overrideProvider(EmailService).useValue({ sendEmail: async () => ({}) })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.listen(0);
  const port = (app.getHttpServer().address() as any).port;
  const s = app.getHttpServer();
  const sse = mod.get(SseService);
  const streams = () => sse.userStreams.size;

  const open = (path: string) => {
    const conn: any = { status: 0, type: '', body: '' };
    conn.req = http.get({ port, path }, (res) => {
      conn.status = res.statusCode;
      conn.type = res.headers['content-type'];
      res.on('data', (d) => (conn.body += d));
    });
    conn.req.on('error', () => {});
    return conn;
  };
  const ticketFor = async (id: string) => (await request(s).post('/sse/ticket').set(auth(id))).body.ticket;
  const subscribe = async (id: string) => {
    const conn = open(`/sse/subscribe?ticket=${encodeURIComponent(await ticketFor(id))}`);
    await wait();
    return conn;
  };

  console.log('--- the old hole');
  let c = open(`/sse/subscribe/${ALICE}`);
  await wait();
  check('old URL with a user id is gone', c.status, 404);
  c.req.destroy();
  sse.emit([ALICE], 'TRANSACTION_ADDED', 'secret');

  console.log('--- without a valid ticket');
  c = open('/sse/subscribe');
  await wait();
  check('no ticket', c.status, 401);
  c.req.destroy();
  c = open(`/sse/subscribe?ticket=${ALICE}`);
  await wait();
  check('user id as a ticket', c.status, 401);
  c.req.destroy();
  c = open(`/sse/subscribe?ticket=${encodeURIComponent(jwt.sign({ id: ALICE }, process.env.ACCESS_TOKEN_SECRET!))}`);
  await wait();
  check('access token as a ticket', c.status, 401);
  c.req.destroy();
  check('no streams were created', streams(), 0);

  console.log('--- getting a ticket');
  check('needs login', (await request(s).post('/sse/ticket')).status, 401);
  const r = await request(s).post('/sse/ticket').set(auth(ALICE));
  check('logged in', r.status, 201);
  check('long random ticket', r.body.ticket.length >= 40, true);
  let threw = false;
  try {
    jwt.verify(r.body.ticket, process.env.ACCESS_TOKEN_SECRET!);
  } catch {
    threw = true;
  }
  check('ticket is not usable as an access token', threw && (await request(s).get('/groups').set({ Authorization: `Bearer ${r.body.ticket}` })).status === 401, true);

  console.log('--- receiving events');
  const alice = await subscribe(ALICE);
  check('stream opens', alice.status, 200);
  check('is an event stream', alice.type?.includes('text/event-stream'), true);
  const bob = await subscribe(BOB);
  sse.emit([ALICE], 'TRANSACTION_ADDED', 'for alice');
  await wait();
  check('alice gets her event', alice.body.includes('for alice'), true);
  check('event keeps the format clients parse', alice.body.includes('event: event') && alice.body.includes('"type":"TRANSACTION_ADDED"'), true);
  check('bob does not get it', bob.body.includes('for alice'), false);

  console.log('--- tickets are single use');
  const ticket = await ticketFor(ALICE);
  const first = open(`/sse/subscribe?ticket=${encodeURIComponent(ticket)}`);
  await wait();
  const second = open(`/sse/subscribe?ticket=${encodeURIComponent(ticket)}`);
  await wait();
  check('first use', first.status, 200);
  check('second use', second.status, 401);
  check('rejection carries no stream', second.body.includes('event:'), false);
  first.req.destroy();
  second.req.destroy();
  await wait();

  console.log('--- disconnecting frees memory');
  check('two users connected', streams(), 2);
  alice.req.destroy();
  await wait();
  check('alice gone after her socket closes', streams(), 1);
  bob.req.destroy();
  await wait();
  check('nothing left', streams(), 0);

  console.log('--- connection limit over HTTP');
  const many: any[] = [];
  for (let i = 0; i < 10; i++) many.push(await subscribe(ALICE));
  check('10 connections open', many.every((x) => x.status === 200), true);
  const extra = await subscribe(ALICE);
  check('11th refused', extra.status, 429);
  extra.req.destroy();
  many.forEach((x) => x.req.destroy());
  await wait();
  check('all freed', streams(), 0);
  const again = await subscribe(ALICE);
  check('can connect again', again.status, 200);
  again.req.destroy();

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
