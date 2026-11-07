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
const { Prisma } = require('@prisma/client');

(Prisma.Decimal.prototype as any).toJSON = function () { return this.toNumber(); };

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

  const mkUser = async (name: string) => {
    const u = await db.user.create({ data: { name, email: `${name}@test.dev`, password: null } });
    return { id: u.id, name, h: { Authorization: `Bearer ${jwt.sign({ id: u.id }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const a = await mkUser('alice');
  const b = await mkUser('bob');
  const c = await mkUser('carol');
  const d = await mkUser('dave');

  const mkGroup = async (owner: any, members: any[]) => {
    const r = await request(s).post('/groups').set(owner.h).field('name', 'G').field('currency', 'EUR');
    for (const m of members) await db.groupMember.create({ data: { groupId: r.body.id, userId: m.id } });
    return r.body.id as string;
  };
  const addExpense = (u: any, G: string, paidBy: any, splits: [any, number][]) =>
    request(s).post('/transactions').set(u.h).send({
      groupId: G, amount: splits.reduce((t, [, n]) => t + n, 0), category: 'FOOD', description: 'Stuff', paidBy: paidBy.id,
      splits: splits.map(([p, amount]) => ({ userId: p.id, amount })),
    });
  const view = (u: any, G: string) => request(s).get(`/groups/${G}`).set(u.h);
  const show = (list: any[]) => list.map((x) => `${x.from.name}->${x.to.name}:${x.amount}`).sort().join(',');
  const debts = async (u: any, G: string) => show((await view(u, G)).body.settlements);
  const pay = (creditor: any, G: string, debtor: any, amount: number) =>
    request(s).post('/transactions/settle').set(creditor.h).send({ groupId: G, amount, description: 'paid', paidBy: debtor.id });
  const leave = (u: any, G: string) => request(s).delete(`/groups/${G}/leave`).set(u.h);
  const remove = (owner: any, G: string, m: any) => request(s).delete(`/groups/${G}/remove/${m.id}`).set(owner.h);
  const isMember = async (G: string, u: any) => !!(await db.groupMember.findUnique({ where: { groupId_userId: { groupId: G, userId: u.id } } }));
  const remaining = async (G: string) => (await db.group.findUnique({ where: { id: G } })).remainingDebts;

  console.log('--- leaving is blocked while money is owed');
  let G = await mkGroup(a, [b, c]);
  await addExpense(a, G, a, [[b, 10]]);
  let r = await leave(b, G);
  check('debtor cannot leave', r.status, 403);
  check('  says why', /settled/.test(r.body.message), true);
  check('  still a member', await isMember(G, b), true);
  r = await remove(a, G, b);
  check('owner cannot remove a debtor', r.status, 403);
  check('  says why', /settled/.test(r.body.message), true);
  check('  still a member', await isMember(G, b), true);
  const owedGroup = await mkGroup(a, [b, c]);
  await addExpense(b, owedGroup, b, [[c, 5]]);
  check('someone who is owed money cannot leave', (await leave(b, owedGroup)).status, 403);
  await addExpense(b, G, b, [[c, 7]]);
  check('net debts: alice is owed by both', await debts(a, G), 'bob->alice:3,carol->alice:7');
  await pay(a, G, b, 3);
  check('bob paid his share', await debts(a, G), 'carol->alice:7');

  console.log('--- leaving works once settled, and the group keeps working');
  check('member with no debts leaves', (await leave(b, G)).status, 200);
  check('  has left', await isMember(G, b), false);
  check('group view still works (was a 500)', (await view(a, G)).status, 200);
  check('  old expenses still listed', (await view(a, G)).body.transactions.length, 3);
  check('  remaining debt unaffected', await debts(a, G), 'carol->alice:7');
  await pay(a, G, c, 7);
  r = await addExpense(a, G, a, [[c, 5]]);
  check('new expense works (was a 500 after saving)', r.status, 201);
  check('  debts', await debts(a, G), 'carol->alice:5');
  check('  remainingDebts', await remaining(G), 1);
  check('mark as paid works', (await pay(a, G, c, 5)).status, 201);
  check('  remainingDebts', await remaining(G), 0);
  const T = (await addExpense(a, G, a, [[c, 2]])).body.id;
  check('delete expense returns the deleted row (was an empty 200)', (await request(s).delete(`/transactions/${T}`).set(a.h)).body.id, T);

  console.log('--- groups already broken by someone who left with a debt');
  G = await mkGroup(a, [b, c]);
  await addExpense(a, G, a, [[b, 10], [c, 10]]);
  await db.groupMember.delete({ where: { groupId_userId: { groupId: G, userId: b.id } } });
  check('group view works (was a 500)', (await view(a, G)).status, 200);
  check('departed debtor shown by name', await debts(a, G), 'bob->alice:10,carol->alice:10');
  check('new expense works', (await addExpense(a, G, a, [[c, 1]])).status, 201);
  check('person owed can mark them as paid', (await pay(a, G, b, 10)).status, 201);
  check('debt cleared', await debts(a, G), 'carol->alice:11');
  const H = await mkGroup(a, [b, c]);
  await addExpense(b, H, b, [[c, 10]]);
  await db.groupMember.delete({ where: { groupId_userId: { groupId: H, userId: b.id } } });
  check('departed creditor shown by name', await debts(a, H), 'carol->bob:10');
  check('departed creditor cannot mark as paid', (await pay(b, H, c, 10)).status, 403);
  await db.groupMember.create({ data: { groupId: H, userId: b.id } });
  check('after rejoining they can', (await pay(b, H, c, 10)).status, 201);

  console.log('--- settlements count correctly through the real API');
  G = await mkGroup(a, [b, c, d]);
  await addExpense(b, G, b, [[a, 10]]);
  await pay(b, G, a, 10);
  check('alice repaid bob', await debts(c, G), '');
  await addExpense(c, G, c, [[b, 10]]);
  check('later expense: bob owes carol, not alice', await debts(c, G), 'bob->carol:10');

  console.log('--- payload the clients read');
  r = await view(a, G);
  check('debt has from.name', typeof r.body.settlements[0].from.name, 'string');
  check('debt amount is a number', typeof r.body.settlements[0].amount, 'number');
  check('balances no longer expose email', JSON.stringify(r.body.balances).includes('@'), false);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
