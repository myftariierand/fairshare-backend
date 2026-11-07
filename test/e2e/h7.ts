// End-to-end check against a disposable Postgres container. Real AppModule and real Prisma;
// email, Expo and Cloudinary are stubbed.
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

  const emitted: { to: string[]; message: string }[] = [];
  const sse = mod.get(SseService);
  const emit = sse.emit.bind(sse);
  sse.emit = (to: string[], t: string, message: string) => { emitted.push({ to, message }); return emit(to, t, message); };

  const mk = async (name: string) => {
    const u = await db.user.create({ data: { name, email: `${name}@test.dev`, password: null } });
    return { id: u.id, name, h: { Authorization: `Bearer ${jwt.sign({ id: u.id }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const owner = await mk('owner');
  const payer = await mk('payer');
  const creator = await mk('creator');
  const debtor = await mk('debtor');
  const other = await mk('other');
  const bystander = await mk('bystander');
  const outsider = await mk('outsider');

  const r0 = await request(s).post('/groups').set(owner.h).field('name', 'G').field('currency', 'EUR');
  const G = r0.body.id;
  for (const m of [payer, creator, debtor, other, bystander]) await db.groupMember.create({ data: { groupId: G, userId: m.id } });

  const body = (over: any = {}) => ({
    groupId: G, amount: 30, category: 'FOOD', description: 'Dinner', paidBy: payer.id,
    splits: [{ userId: debtor.id, amount: 10 }, { userId: other.id, amount: 20 }], ...over,
  });
  const add = async (over: any = {}, u = creator) => (await request(s).post('/transactions').set(u.h).send(body(over))).body.id;
  const edit = (id: string, u: any, over: any = {}) => request(s).patch(`/transactions/${id}`).set(u.h).send(body(over));
  const del = (id: string, u: any) => request(s).delete(`/transactions/${id}`).set(u.h);
  const splits = async (id: string) =>
    (await db.transactionSplit.findMany({ where: { transactionId: id }, include: { user: { select: { name: true } } } }))
      .map((x: any) => `${x.user.name}:${x.amount}`).sort().join(',');
  const debts = async () =>
    (await request(s).get(`/groups/${G}`).set(owner.h)).body.settlements.map((x: any) => `${x.from.name}->${x.to.name}:${x.amount}`).sort().join(',');
  const exists = async (id: string) => !!(await db.transaction.findUnique({ where: { id } }));

  console.log('--- edits really change who is in the split');
  let T = await add();
  check('starting debts', await debts(), 'debtor->payer:10,other->payer:20');
  let r = await edit(T, creator, { amount: 20, splits: [{ userId: other.id, amount: 20 }] });
  check('take someone off', r.status, 200);
  check('  splits replaced', await splits(T), 'other:20');
  check('  their debt is gone (used to stay)', await debts(), 'other->payer:20');
  r = await edit(T, creator, { amount: 40, splits: [{ userId: other.id, amount: 20 }, { userId: bystander.id, amount: 20 }] });
  check('add someone new', r.status, 200);
  check('  splits replaced (used to be ignored)', await splits(T), 'bystander:20,other:20');
  check('  they now owe', await debts(), 'bystander->payer:20,other->payer:20');
  r = await edit(T, creator, { amount: 30, description: 'Lunch', paidBy: other.id, splits: [{ userId: other.id, amount: 15 }, { userId: debtor.id, amount: 15 }] });
  check('change everything at once', r.status, 200);
  check('  saved', (await db.transaction.findUnique({ where: { id: T } })).description, 'Lunch');
  check('  splits add up to the amount', await splits(T), 'debtor:15,other:15');
  check('  remainingDebts stays right', (await db.group.findUnique({ where: { id: G } })).remainingDebts, 1);
  await db.transaction.delete({ where: { id: T } });

  console.log('--- bad edits change nothing');
  T = await add();
  const before = await splits(T);
  check('splits do not add up', (await edit(T, creator, { amount: 31 })).status, 403);
  check('  untouched', await splits(T), before);
  check('duplicate person', (await edit(T, creator, { amount: 20, splits: [{ userId: debtor.id, amount: 10 }, { userId: debtor.id, amount: 10 }] })).status, 400);
  check('  untouched', await splits(T), before);
  check('adding a non-member', (await edit(T, creator, { amount: 10, splits: [{ userId: outsider.id, amount: 10 }] })).status, 403);
  check('  untouched', await splits(T), before);
  r = await edit(T, creator, { amount: 1000000000, splits: [{ userId: debtor.id, amount: 1000000000 }] });
  check('amount too large for the database fails', r.status >= 400, true);
  check('  rolled back, splits not lost', await splits(T), before);
  check('  amount unchanged', (await db.transaction.findUnique({ where: { id: T } })).amount.toNumber(), 30);
  check('creating with a duplicate person', (await request(s).post('/transactions').set(creator.h).send(body({ amount: 20, splits: [{ userId: debtor.id, amount: 10 }, { userId: debtor.id, amount: 10 }] }))).status, 400);

  console.log('--- someone who left stays on old expenses');
  const gone = await mk('gone');
  await db.groupMember.create({ data: { groupId: G, userId: gone.id } });
  const T3 = await add({ amount: 10, splits: [{ userId: gone.id, amount: 10 }] });
  await db.groupMember.delete({ where: { groupId_userId: { groupId: G, userId: gone.id } } });
  r = await edit(T3, creator, { amount: 12, splits: [{ userId: gone.id, amount: 12 }] });
  check('edit keeping them', r.status, 200);
  check('  saved', await splits(T3), 'gone:12');
  check('but they can no longer edit it themselves', (await edit(T3, gone, { amount: 1, splits: [{ userId: gone.id, amount: 1 }] })).status, 403);
  check('or delete it (used to work)', (await del(T3, gone)).status, 404);
  await db.transaction.delete({ where: { id: T3 } });

  console.log('--- who can edit');
  const editAs = (u: any) => edit(T, u, { description: `by ${u.name}` });
  check('debtor', (await editAs(debtor)).status, 403);
  check('  says why', /Only the person/.test((await editAs(debtor)).body.message), true);
  check('debtor cannot shrink their own share', (await edit(T, debtor, { amount: 20.01, splits: [{ userId: debtor.id, amount: 0.01 }, { userId: other.id, amount: 20 }] })).status, 403);
  check('  untouched', await splits(T), before);
  check('uninvolved member', (await editAs(bystander)).status, 403);
  check('non-member', (await editAs(outsider)).status, 403);
  check('person who added it', (await editAs(creator)).status, 200);
  check('person who paid', (await editAs(payer)).status, 200);
  check('group owner', (await editAs(owner)).status, 200);

  console.log('--- who can delete');
  check('debtor cannot erase their debt (used to work)', (await del(T, debtor)).status, 403);
  check('  still there', await exists(T), true);
  check('  debt still owed', await debts(), 'debtor->payer:10,other->payer:20');
  check('uninvolved member', (await del(T, bystander)).status, 403);
  check('non-member', (await del(T, outsider)).status, 404);
  check('person who added it', (await del(T, creator)).status, 200);
  check('  gone', await exists(T), false);
  check('person who paid', (await del(await add(), payer)).status, 200);
  check('group owner', (await del(await add(), owner)).status, 200);
  r = await del(await add(), creator);
  check('response keeps the shape clients read', !!r.body.group?.id && Array.isArray(r.body.splits), true);
  check('missing transaction', (await del('99999999-9999-4999-8999-999999999999', owner)).status, 404);

  console.log('--- settlements');
  const pay = async () => {
    const e = await add({ amount: 10, splits: [{ userId: debtor.id, amount: 10 }] });
    const st = await request(s).post('/transactions/settle').set(payer.h).send({ groupId: G, amount: 10, description: 'paid', paidBy: debtor.id });
    return { e, id: st.body.id };
  };
  let p = await pay();
  check('debtor cannot delete the record of paying', (await del(p.id, debtor)).status, 200 === 0 ? 0 : 403);
  check('uninvolved member cannot', (await del(p.id, bystander)).status, 403);
  check('person owed who recorded it can undo it', (await del(p.id, payer)).status, 200);
  check('  debt comes back', await debts(), 'debtor->payer:10');
  await del(p.e, payer);
  p = await pay();
  check('group owner can', (await del(p.id, owner)).status, 200);
  await del(p.e, payer);

  console.log('--- notifications on delete');
  emitted.length = 0;
  const T4 = await add();
  emitted.length = 0;
  await del(T4, creator);
  const n = emitted.find((e) => e.message.includes('deleted'))!;
  check('payer outside the split is told (used to be missed)', n.to.includes(payer.id), true);
  check('people in the split are told', n.to.includes(debtor.id) && n.to.includes(other.id), true);
  check('names the person who deleted it', n.message.startsWith('creator deleted'), true);
  emitted.length = 0;
  const T5 = await add({}, payer);
  emitted.length = 0;
  await del(T5, payer);
  check('not told about your own action', emitted.find((e) => e.message.includes('deleted'))!.to.includes(payer.id), false);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
