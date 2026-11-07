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
  const owed = await mkUser('owed');
  const debtor = await mkUser('debtor');
  const debtor2 = await mkUser('debtor2');
  const outsider = await mkUser('outsider');

  const mkGroup = async (name: string, owner: any, members: any[] = []) => {
    const r = await request(s).post('/groups').set(owner.h).field('name', name).field('currency', 'EUR');
    for (const m of members) await db.groupMember.create({ data: { groupId: r.body.id, userId: m.id } });
    return r.body.id;
  };
  const G = await mkGroup('Trip', owed, [debtor, debtor2]);
  const OWN = await mkGroup('Outsider own group', outsider);
  const DEBTOR_OWN = await mkGroup('Debtor other group', debtor);

  const expense = (over: any = {}) => ({
    groupId: G, amount: 30, category: 'FOOD', description: 'Dinner', paidBy: owed.id,
    splits: [{ userId: debtor.id, amount: 10 }, { userId: debtor2.id, amount: 20 }], ...over,
  });
  const debts = async () => (await request(s).get(`/groups/${G}`).set(owed.h)).body.settlements;
  const show = (d: any[]) => d.map((x) => `${x.from.name}->${x.to.name}:${x.amount}`).sort().join(',');

  let r = await request(s).post('/transactions').set(owed.h).send(expense());
  check('create expense', r.status, 201);
  const T = r.body.id;
  check('debts after expense', show(await debts()), 'debtor->owed:10,debtor2->owed:20');

  console.log('--- creating');
  const before = await db.transaction.count();
  check('non-member payer rejected', (await request(s).post('/transactions').set(owed.h).send(expense({ paidBy: outsider.id }))).status, 403);
  check('  no row created', await db.transaction.count(), before);
  check('group view still works', (await request(s).get(`/groups/${G}`).set(owed.h)).status, 200);

  console.log('--- updating');
  const hack = (over: any = {}) => ({ ...expense(), amount: 1, description: 'hacked', paidBy: outsider.id, splits: [{ userId: outsider.id, amount: 1 }], ...over });
  const stored = () => db.transaction.findUnique({ where: { id: T } });
  check('outsider using their own group', (await request(s).patch(`/transactions/${T}`).set(outsider.h).send(hack({ groupId: OWN }))).status, 404);
  check('outsider naming the real group', (await request(s).patch(`/transactions/${T}`).set(outsider.h).send(hack())).status, 403);
  check('member using another group of theirs', (await request(s).patch(`/transactions/${T}`).set(debtor.h).send(expense({ groupId: DEBTOR_OWN, description: 'hacked' }))).status, 404);
  check('  description untouched', (await stored()).description, 'Dinner');
  check('  amount untouched', (await stored()).amount.toNumber(), 30);
  check('payer changed to a non-member', (await request(s).patch(`/transactions/${T}`).set(owed.h).send(expense({ paidBy: outsider.id }))).status, 403);
  check('  payer untouched', (await stored()).paidById, owed.id);
  r = await request(s).patch(`/transactions/${T}`).set(owed.h).send(expense({ description: 'Dinner out' }));
  check('member edits with the real group', r.status, 200);
  check('  saved', (await stored()).description, 'Dinner out');

  console.log('--- settling: who can');
  const settle = (u: any, over: any = {}) => request(s).post('/transactions/settle').set(u.h).send({ groupId: G, amount: 10, description: 'settled', paidBy: debtor.id, ...over });
  const settlements = () => db.transaction.count({ where: { groupId: G, type: 'SETTLEMENT' } });
  check('outsider', (await settle(outsider)).status, 403);
  check('debtor clears own debt', (await settle(debtor, { paidBy: owed.id })).status, 400);
  check('debtor with huge amount', (await settle(debtor, { paidBy: owed.id, amount: 1000000 })).status, 400);
  check('third member clears someone else', (await settle(debtor2)).status, 400);
  check('settle with yourself', (await settle(owed, { paidBy: owed.id })).status, 400);
  check('paidBy is a non-member', (await settle(owed, { paidBy: outsider.id })).status, 400);
  check('nothing was recorded', await settlements(), 0);
  check('debts unchanged', show(await debts()), 'debtor->owed:10,debtor2->owed:20');

  console.log('--- settling: amounts');
  check('more than owed', (await settle(owed, { amount: 10.01 })).status, 400);
  check('rounds to zero', (await settle(owed, { amount: 0.001 })).status, 400);
  check('nothing was recorded', await settlements(), 0);
  check('partial payment', (await settle(owed, { amount: 4 })).status, 201);
  check('  debt reduced', show(await debts()), 'debtor->owed:6,debtor2->owed:20');
  check('more than what is left', (await settle(owed, { amount: 7 })).status, 400);

  console.log('--- settling: exactly what both clients send');
  for (const d of await debts()) {
    r = await settle(owed, { amount: d.amount, paidBy: d.from.id });
    check(`mark ${d.from.name} as paid`, r.status, 201);
  }
  check('no debts left', (await debts()).length, 0);
  check('remainingDebts', (await db.group.findUnique({ where: { id: G } })).remainingDebts, 0);
  check('settling again', (await settle(owed, { amount: 1 })).status, 400);

  console.log('--- settlements are final');
  const st = await db.transaction.findFirst({ where: { groupId: G, type: 'SETTLEMENT' } });
  check('cannot edit a settlement', (await request(s).patch(`/transactions/${st.id}`).set(owed.h).send(expense({ amount: 30 }))).status, 404);

  console.log('--- an expense whose payer later left can still be edited');
  r = await request(s).post('/transactions').set(owed.h).send(expense({ paidBy: debtor.id, splits: [{ userId: debtor.id, amount: 30 }] }));
  const T2 = r.body.id;
  await db.groupMember.delete({ where: { groupId_userId: { groupId: G, userId: debtor.id } } });
  check('edit keeping the departed payer', (await request(s).patch(`/transactions/${T2}`).set(owed.h).send(expense({ paidBy: debtor.id, description: 'kept', splits: [{ userId: debtor.id, amount: 30 }] }))).status, 200);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
