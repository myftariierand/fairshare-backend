// End-to-end check on a disposable Postgres, with Expo, email and Cloudinary all failing for
// real. Nothing leaves this machine: Expo is stubbed, email is stubbed, and Cloudinary points at a closed
// local port. Node's default for an unhandled rejection is to exit, so each one found here is a crash.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.REFRESH_TOKEN_SECRET = 'audit-refresh';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
process.env.GOOGLE_CLIENT_ID = 'x';
process.env.GOOGLE_CLIENT_SECRET = 'x';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost/cb';
process.env.RESEND_API_KEY = 're_fake';
process.env.CLOUDINARY_CLOUD_NAME = 'audit';
process.env.CLOUDINARY_API_KEY = 'audit';
process.env.CLOUDINARY_API_SECRET = 'audit';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('refusing to run outside the throwaway database');

const P = require('path').resolve(__dirname, '../..');
const R = `${P}/src`;
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { Expo } from 'expo-server-sdk';
import { v2 as cloudinary } from 'cloudinary';

let expoCalls = 0;
(Expo.prototype as any).sendPushNotificationsAsync = async () => {
  expoCalls++;
  throw new Error('simulated Expo outage');
};

const unhandled: string[] = [];
process.on('unhandledRejection', (e: any) => unhandled.push(String(e?.message ?? JSON.stringify(e))));

const { AppModule } = require(`${R}/app.module`);
const { DatabaseService } = require(`${R}/database/database.service`);
const { EmailService } = require(`${R}/email/email.service`);
const { CloudinaryService } = require(`${R}/cloudinary/cloudinary.service`);

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};
const settle = () => new Promise((f) => setTimeout(f, 120));

(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(require('@nestjs/throttler').ThrottlerStorage).useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
    .overrideProvider(EmailService).useValue({ sendEmail: async () => { throw new Error('simulated Resend failure'); } })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.init();
  cloudinary.config({ upload_prefix: 'http://127.0.0.1:1' });
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P); // renderTemplate reads templates/ relative to cwd

  const mkUser = async (name: string, i: number) => {
    const u = await db.user.create({ data: { name, email: `${name}@test.dev`, password: null } });
    await db.deviceToken.create({ data: { token: `ExponentPushToken[${String(i).repeat(22)}]`, platform: 'ios', userId: u.id } });
    return { id: u.id, h: { Authorization: `Bearer ${jwt.sign({ id: u.id }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const a = await mkUser('alice', 1);
  const b = await mkUser('bob', 2);
  const c = await mkUser('carol', 3);

  const flow = async (name: string, want: number, run: () => any) => {
    const before = expoCalls;
    const r = await run();
    await settle();
    check(name, r.status, want);
    return { r, pushed: expoCalls > before };
  };

  console.log('--- every request succeeds while Expo and email are down');
  let f = await flow('bug report', 201, () => request(s).post('/bug-reports').set(a.h).send({ title: 'abc', description: 'long enough text' }));
  check('  saved', await db.bugReport.count(), 1);
  f = await flow('friend request (data-only push)', 201, () => request(s).post(`/friends/requests/${b.id}`).set(a.h));
  check('  push was attempted', f.pushed, true);
  f = await flow('accept friend request', 200, async () => request(s).patch(`/friends/requests/${(await db.friendships.findFirst()).id}/accept`).set(b.h));
  check('  push was attempted', f.pushed, true);
  await request(s).post(`/friends/requests/${c.id}`).set(a.h);
  await settle();
  f = await flow('reject friend request', 200, async () => request(s).patch(`/friends/requests/${(await db.friendships.findFirst({ where: { receiverId: c.id } })).id}/reject`).set(c.h));
  check('  push was attempted', f.pushed, true);

  const G = (await request(s).post('/groups').set(a.h).field('name', 'G').field('currency', 'EUR')).body.id;
  await db.group.update({ where: { id: G }, data: { cover: 'group/old-cover' } });
  f = await flow('group invite', 201, () => request(s).post(`/groups/${G}/invite/${b.id}`).set(a.h));
  check('  push was attempted', f.pushed, true);
  const inv = await db.groupInvitation.findFirst({ where: { receiverId: b.id } });
  f = await flow('accept invite', 201, () => request(s).post(`/groups/${G}/invite/${inv.id}/accept`).set(b.h));
  check('  push was attempted', f.pushed, true);
  check('  member added', !!(await db.groupMember.findUnique({ where: { groupId_userId: { groupId: G, userId: b.id } } })), true);
  await request(s).post(`/groups/${G}/invite/${c.id}`).set(a.h);
  await settle();
  const inv2 = await db.groupInvitation.findFirst({ where: { receiverId: c.id } });
  await flow('reject invite', 201, () => request(s).post(`/groups/invite/${inv2.id}/reject`).set(c.h));

  const expense = { groupId: G, amount: 10, category: 'FOOD', description: 'Stuff', paidBy: a.id, splits: [{ userId: b.id, amount: 10 }] };
  f = await flow('create expense', 201, () => request(s).post('/transactions').set(a.h).send(expense));
  check('  push was attempted', f.pushed, true);
  const T = f.r.body.id;
  f = await flow('update expense', 200, () => request(s).patch(`/transactions/${T}`).set(a.h).send({ ...expense, description: 'Other' }));
  check('  push was attempted', f.pushed, true);
  f = await flow('mark as paid', 201, () => request(s).post('/transactions/settle').set(a.h).send({ groupId: G, amount: 10, description: 'paid', paidBy: b.id }));
  check('  push was attempted', f.pushed, true);
  const T2 = (await request(s).post('/transactions').set(a.h).send({ ...expense, splits: [{ userId: a.id, amount: 5 }, { userId: b.id, amount: 5 }] })).body.id;
  await settle();
  f = await flow('delete expense', 200, () => request(s).delete(`/transactions/${T2}`).set(a.h));
  check('  push was attempted', f.pushed, true);

  console.log('--- Cloudinary is down (real SDK, closed port)');
  const service = mod.get(CloudinaryService);
  let rejected: any = null;
  await service.deleteFile('group/anything').catch((e: any) => (rejected = e));
  await settle();
  check('deleteFile rejects to its caller', rejected !== null, true);
  r_check: {
    const r = await request(s).patch(`/groups/${G}`).set(a.h).field('name', 'G').field('currency', 'EUR').field('removeCover', 'true');
    await settle();
    check('removing a cover still succeeds', r.status, 200);
    check('  cover cleared in the database', (await db.group.findUnique({ where: { id: G } })).cover, null);
  }
  await db.group.update({ where: { id: G }, data: { cover: 'group/old-cover-2' } });
  await flow('deleting a group with a cover', 200, () => request(s).delete(`/groups/${G}`).set(a.h));

  console.log('--- the point of all this');
  check('Expo was really called and failing', expoCalls > 5, true);
  check('unhandled rejections (each one would be a crash)', unhandled.length, 0);
  if (unhandled.length) console.log(unhandled.join('\n'));
  check('server still answers', (await request(s).get('/groups').set(a.h)).status, 200);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
