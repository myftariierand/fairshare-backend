// End-to-end check against a disposable Postgres container. Real AppModule and real Prisma;
// only email, Expo and Cloudinary are stubbed.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.REFRESH_TOKEN_SECRET = 'audit-refresh';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
process.env.GOOGLE_CLIENT_ID = 'x';
process.env.GOOGLE_CLIENT_SECRET = 'x';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost/cb';
process.env.RESEND_API_KEY = 're_fake';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('refusing to run outside the throwaway database');

const R = require('path').resolve(__dirname, '../../src');
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { Expo } from 'expo-server-sdk';

(Expo.prototype as any).sendPushNotificationsAsync = async () => [];

const { AppModule } = require(`${R}/app.module`);
const { DatabaseService } = require(`${R}/database/database.service`);
const { EmailService } = require(`${R}/email/email.service`);
const { CloudinaryService } = require(`${R}/cloudinary/cloudinary.service`);
const { SseService } = require(`${R}/sse/sse.service`);

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
    .overrideProvider(CloudinaryService).useValue({ uploadFile: async () => ({ public_id: 'x' }), deleteFile: async () => ({}) })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.init();
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);

  const events: string[] = [];
  const sse = mod.get(SseService);
  const realEmit = sse.emit.bind(sse);
  sse.emit = (r: string[], t: string, m: string) => { events.push(t); return realEmit(r, t, m); };

  const mkUser = async (name: string) => {
    const u = await db.user.create({ data: { name, email: `${name}@test.dev`, password: null } });
    return { id: u.id, name, h: { Authorization: `Bearer ${jwt.sign({ id: u.id }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const owner = await mkUser('owner');
  const member = await mkUser('member');
  const outsider = await mkUser('outsider');

  const mkGroup = async (u: any, members: any[] = []) => {
    const r = await request(s).post('/groups').set(u.h).field('name', 'G').field('currency', 'EUR');
    for (const m of members) await db.groupMember.create({ data: { groupId: r.body.id, userId: m.id } });
    return r.body.id as string;
  };
  const G = await mkGroup(owner, [member]);
  const OTHER = await mkGroup(outsider);

  const url = (g: string, rest = '') => `/groups/${g}/tasks${rest}`;
  const add = (u: any, g: string, text: string) => request(s).post(url(g)).set(u.h).send({ text });
  const task = (id: string) => db.task.findUnique({ where: { id } });
  const count = () => db.task.count({ where: { groupId: G } });

  console.log('--- members can use the checklist');
  let r = await add(owner, G, 'Buy milk');
  check('create', r.status, 201);
  const T1 = r.body.id;
  check('  includes creator name', r.body.createdBy?.name, 'owner');
  check('  notifies after saving', events.at(-1), 'CHECKLIST_ITEM_ADDED');
  const T2 = (await add(member, G, 'Buy eggs')).body.id;
  r = await request(s).get(url(G)).set(member.h);
  check('list', r.status, 200);
  check('  newest first', r.body.map((t: any) => t.text).join(','), 'Buy eggs,Buy milk');
  r = await request(s).patch(url(G, `/${T1}`)).set(member.h).send({ done: true });
  check('update', r.status, 200);
  check('  saved', (await task(T1)).done, true);
  r = await request(s).put(url(G, '/reorder')).set(member.h).send({ orderedIds: [T1, T2] });
  check('reorder', r.status, 200);
  check('  new order', r.body.map((t: any) => t.id).join(','), `${T1},${T2}`);

  console.log('--- non-members are blocked on every route');
  check('no token', (await request(s).get(url(G))).status, 401);
  check('read', (await request(s).get(url(G)).set(outsider.h)).status, 403);
  let before = await count();
  check('create', (await add(outsider, G, 'spam')).status, 403);
  check('  no row', await count(), before);
  check('update', (await request(s).patch(url(G, `/${T1}`)).set(outsider.h).send({ text: 'hacked' })).status, 403);
  check('  text untouched', (await task(T1)).text, 'Buy milk');
  check('reorder', (await request(s).put(url(G, '/reorder')).set(outsider.h).send({ orderedIds: [T2, T1] })).status, 403);
  check('  position untouched', (await task(T1)).position, 0);
  check('delete', (await request(s).delete(url(G, `/${T1}`)).set(outsider.h)).status, 403);
  check('  still there', !!(await task(T1)), true);
  check('malformed group id', (await request(s).get(url('nope')).set(owner.h)).status, 403);

  console.log('--- using your own group to reach another group\'s task');
  const OWN = (await add(outsider, OTHER, 'Mine')).body.id;
  events.length = 0;
  check('update through own group', (await request(s).patch(url(OTHER, `/${T1}`)).set(outsider.h).send({ text: 'hacked' })).status, 403);
  check('  text untouched', (await task(T1)).text, 'Buy milk');
  check('delete through own group (was a 200)', (await request(s).delete(url(OTHER, `/${T1}`)).set(outsider.h)).status, 403);
  check('  still there', !!(await task(T1)), true);
  check('reorder through own group (was a 200)', (await request(s).put(url(OTHER, '/reorder')).set(outsider.h).send({ orderedIds: [T2] })).status, 404);
  check('  position untouched', (await task(T2)).position, 1);
  check('mixed reorder is cancelled', (await request(s).put(url(OTHER, '/reorder')).set(outsider.h).send({ orderedIds: [OWN, T2] })).status, 404);
  check('  foreign position untouched', (await task(T2)).position, 1);
  check('  own task rolled back too', (await task(OWN)).position, -1);
  check('blocked attempts notified nobody', events.length, 0);

  console.log('--- losing membership loses access');
  r = await request(s).delete(`/groups/${G}/remove/${member.id}`).set(owner.h);
  check('member removed', r.status, 200);
  check('removed member cannot read', (await request(s).get(url(G)).set(member.h)).status, 403);
  check('removed member cannot edit', (await request(s).patch(url(G, `/${T2}`)).set(member.h).send({ text: 'x' })).status, 403);

  console.log('--- deleting');
  events.length = 0;
  r = await request(s).delete(url(G, `/${T2}`)).set(owner.h);
  check('owner deletes', r.status, 200);
  check('  gone', await task(T2), null);
  check('  notifies after saving', events.at(-1), 'CHECKLIST_ITEM_DELETED');
  events.length = 0;
  check('deleting again', (await request(s).delete(url(G, `/${T2}`)).set(owner.h)).status, 403);
  check('  no notification', events.length, 0);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
