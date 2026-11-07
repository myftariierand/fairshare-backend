// End-to-end check of money handling. The real app and database; only email is replaced.
// Bodies are sent as raw JSON where a value can't be written as a normal JS number. Postgres is disposable.
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
const { Prisma } = require('@prisma/client');

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
  // main.ts does this in production
  Prisma.Decimal.prototype.toJSON = function () { return this.toNumber(); };
  await app.listen(0);
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);
  process.chdir(P);

  let n = 0;
  const mk = async () => {
    const u = await db.user.create({ data: { name: `U${++n}`, email: `u${n}@test.dev`, emailVerified: true } });
    return { ...u, h: { Authorization: `Bearer ${jwt.sign({ id: u.id }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const [a, b, c, d] = [await mk(), await mk(), await mk(), await mk()];
  const mkGroup = (currency = 'EUR') => db.group.create({ data: { name: 'Trip', currency, createdById: a.id, members: { create: [a, b, c, d].map((u) => ({ userId: u.id })) } } });
  let g = await mkGroup();

  const add = (amount: number, splits: [any, number][], group = g) => request(s).post('/transactions').set(a.h).send({ groupId: group.id, amount, category: 'FOOD', description: 'Lunch', paidBy: a.id, splits: splits.map(([u, x]) => ({ userId: u.id, amount: x })) });
  const addRaw = (amountText: string) => request(s).post('/transactions').set(a.h).set('Content-Type', 'application/json').send(`{"groupId":"${g.id}","amount":${amountText},"category":"FOOD","description":"Lunch","paidBy":"${a.id}","splits":[{"userId":"${a.id}","amount":${amountText}}]}`);
  const settle = (amount: number, from: any, by: any = a, group = g) => request(s).post('/transactions/settle').set(by.h).send({ groupId: group.id, amount, description: 'Paid back', paidBy: from.id });
  const view = (group = g, u: any = a) => request(s).get(`/groups/${group.id}`).set(u.h);

  console.log('--- the biggest amount the database can hold');
  let r = await add(99999999.99, [[a, 99999999.99]]);
  check('at the limit', r.status, 201);
  check('  comes back exact', r.body.amount, 99999999.99);
  check('over it (the audit found a 500)', (await add(100000000, [[a, 100000000]])).status, 400);
  check('far over it', (await addRaw('1e30')).status, 400);
  check('infinity, which JSON can spell as 1e400', (await addRaw('1e400')).status, 400);
  check('zero', (await add(0, [[a, 0]])).status, 400);
  check('negative', (await add(-5, [[a, -5]])).status, 400);
  check('a string', (await addRaw('"10"')).status, 400);

  console.log('--- decimal places');
  check('1 cent', (await add(0.01, [[a, 0.01]])).status, 201);
  check('less than a cent', (await add(0.001, [[a, 0.001]])).status, 400);
  check('three decimals', (await add(12.345, [[a, 12.345]])).status, 400);
  check('a float that has drifted', (await addRaw('0.30000000000000004')).status, 400);
  const before = await db.transaction.count({ where: { groupId: g.id } });
  check('splits that only add up after rounding', (await add(10, [[a, 5.005], [b, 4.995]])).status, 400);
  check('  nothing saved', await db.transaction.count({ where: { groupId: g.id } }), before);
  check('update is held to the same rules', (await request(s).patch(`/transactions/${r.body.id}`).set(a.h).send({ groupId: g.id, amount: 1.234, category: 'FOOD', description: 'Lunch', paidBy: a.id, splits: [{ userId: a.id, amount: 1.234 }] })).status, 400);
  check('settling a fraction of a cent', (await settle(0.001, b)).status, 400);
  check('settling over the limit', (await settle(100000000, b)).status, 400);

  console.log('--- what the audit saw: three 0.1 splits');
  g = await mkGroup();
  r = await add(0.3, [[b, 0.1], [c, 0.1], [d, 0.1]]);
  check('saved', r.status, 201);
  let v = await view();
  check('payer\'s balance in the group', v.body.transactions[0].balance, 0.3);
  check('  debts add up', v.body.settlements?.reduce?.((sum: number, x: any) => sum + Math.round(x.amount * 100), 0), 30);
  const list = await request(s).get(`/transactions/${g.id}`).set(a.h);
  const shown = (list.body.data ?? list.body)[0];
  check('payer\'s balance in the list', shown.balance, 0.3);
  check('someone who owes', (await view(g, b)).body.transactions[0].balance, -0.1);

  console.log('--- the amounts both clients produce are all accepted, and add up');
  g = await mkGroup();
  let refused = 0, mismatched = 0;
  const distribute = (cents: number, ways: number) => {
    const parts = Array.from({ length: ways }, () => Math.floor(cents / ways));
    const remainder = cents - parts.reduce((x, y) => x + y, 0);
    for (let i = 0; i < remainder; i++) parts[i]++;
    return parts.map((p) => parseFloat((p / 100).toFixed(2)));
  };
  const people = [a, b, c, d];
  for (const total of [19.99, 0.07, 4.35, 1.1, 1234.56, 33.33, 100, 0.03, 8.2, 1.15, 2.675, 1.005, 99.99, 1000.01, 70.07].filter((x) => Math.round(x * 100) / 100 === x)) {
    for (const ways of [2, 3, 4]) {
      const parts = distribute(Math.round(total * 100), ways).filter((p) => p > 0);
      const res = await add(total, parts.map((p, i) => [people[i], p]));
      if (res.status !== 201) { refused++; continue; }
      const row = await db.transaction.findUnique({ where: { id: res.body.id }, include: { splits: true } });
      const sum = row.splits.reduce((acc: any, x: any) => acc.add(x.amount), new Prisma.Decimal(0));
      if (!sum.equals(row.amount)) mismatched++;
    }
  }
  check('none refused', refused, 0);
  check('splits always equal the total', mismatched, 0);

  console.log('--- settling exactly what is shown clears the debt');
  g = await mkGroup();
  check('setup', (await add(19.99, [[a, 6.67], [b, 6.66], [c, 6.66]])).status, 201);
  v = await view();
  for (const debt of v.body.settlements ?? []) {
    const debtor = [b, c].find((u) => u.id === debt.from.id);
    check(`  settling ${debt.amount}`, (await settle(debt.amount, debtor)).status, 201);
  }
  check('nothing left', (await db.group.findUnique({ where: { id: g.id } })).remainingDebts, 0);

  console.log('--- large balances stay exact');
  g = await mkGroup();
  await add(99999999.99, [[b, 99999999.99]]);
  await add(99999999.99, [[b, 99999999.99]]);
  v = await view();
  check('two of the largest amounts', v.body.settlements?.[0]?.amount, 199999999.98);
  check('can be paid off in parts', (await settle(99999999.99, b)).status, 201);
  check('  rest is exact', (await view()).body.settlements?.[0]?.amount, 99999999.99);

  console.log('--- currencies with no decimals');
  const yen = await mkGroup('JPY');
  check('whole amounts', (await add(1000, [[a, 334], [b, 333], [c, 333]], yen)).status, 201);
  r = await add(10.5, [[a, 10.5]], yen);
  check('a fraction of a yen', r.status, 400);
  check('  says why', /decimal/i.test(r.body.message), true);
  check('split with a fraction', (await add(10, [[a, 5.5], [b, 4.5]], yen)).status, 400);
  const won = await mkGroup('KRW');
  check('another one the clients don\'t offer', (await add(10.5, [[a, 10.5]], won)).status, 400);
  const dinar = await mkGroup('KWD');
  check('three-decimal currency is held to what the database stores', (await add(10.5, [[a, 10.5]], dinar)).status, 201);

  console.log('--- older yen groups with fractions can still be settled');
  const old = await mkGroup('JPY');
  await db.transaction.create({ data: { amount: 10.4, description: 'Old one', groupId: old.id, paidById: a.id, createdById: a.id, splits: { create: { userId: b.id, amount: 10.4 } } } });
  const debt = (await view(old)).body.settlements?.[0]?.amount;
  check('debt', debt, 10.4);
  check('settles', (await settle(debt, b, a, old)).status, 201);
  check('  cleared', (await view(old)).body.settlements?.length, 0);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
