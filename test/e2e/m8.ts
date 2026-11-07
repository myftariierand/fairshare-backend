// End-to-end check of the group and friendship rules. The real app and database; only email
// is replaced. Postgres is disposable.
process.env.ACCESS_TOKEN_SECRET = 'audit-access-secret-for-tests-only-0123456789';
process.env.RESET_PASSWORD_SECRET = 'audit-reset-secret-for-tests-only-0123456789';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('refusing to run outside the throwaway database');

const P = require('path').resolve(__dirname, '../..');
const R = `${P}/src`;
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

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
  const [a, b, c, d] = [await mk(), await mk(), await mk(), await mk()];

  // Members join one at a time so "longest-standing" is unambiguous
  const mkGroup = async (owner: any, others: any[] = [], currency = 'EUR') => {
    const g = await db.group.create({ data: { name: 'Trip', currency, createdById: owner.id, members: { create: { userId: owner.id, joinedAt: new Date(2020, 0, 1) } } } });
    for (const [i, u] of others.entries()) await db.groupMember.create({ data: { groupId: g.id, userId: u.id, joinedAt: new Date(2021, i, 1) } });
    return g;
  };
  const edit = (u: any, g: any, currency: string, name = 'Trip') => request(s).patch(`/groups/${g.id}`).set(u.h).field('name', name).field('currency', currency);
  const addTx = (u: any, g: any, over: any = {}) => request(s).post('/transactions').set(u.h).send({ groupId: g.id, amount: 10, category: 'FOOD', description: 'Lunch', paidBy: u.id, splits: [{ userId: u.id, amount: 10 }], ...over });
  const leave = (u: any, g: any) => request(s).delete(`/groups/${g.id}/leave`).set(u.h);
  const fresh = (g: any) => db.group.findUnique({ where: { id: g.id } });

  console.log('--- currency: changing it would reinterpret every amount with no conversion');
  let g = await mkGroup(a, [b]);
  check('no expenses: can change', (await edit(b, g, 'USD')).status, 200);
  const tx = await addTx(a, g);
  check('setup', tx.status, 201);
  let r = await edit(a, g, 'GBP');
  check('with an expense: refused', r.status, 409);
  check('  says why', /currency/i.test(r.body.message), true);
  check('  unchanged', (await fresh(g)).currency, 'USD');
  check('  even for the owner, and a rename in the same request is not saved', (await edit(a, g, 'GBP', 'Renamed')).status, 409);
  check('  name unchanged', (await fresh(g)).name, 'Trip');
  r = await edit(b, g, 'USD', 'Renamed');
  check('same currency with a new name, as the clients send', r.status, 200);
  check('  saved', (await fresh(g)).name, 'Renamed');
  await request(s).delete(`/transactions/${tx.body.id}`).set(a.h);
  check('no expenses again: can change', (await edit(a, g, 'CHF')).status, 200);

  let raced = 0;
  for (let i = 0; i < 6; i++) {
    const rg = await mkGroup(a);
    await Promise.all([edit(a, rg, 'USD'), addTx(a, rg)]);
    const after = await fresh(rg);
    // An expense entered as EUR that ended up counted in USD is the failure
    const txs = await db.transaction.findMany({ where: { groupId: rg.id } });
    const log = await db.activityLog.findFirst({ where: { groupId: rg.id, action: 'GROUP_UPDATED' } });
    const logTx = await db.activityLog.findFirst({ where: { groupId: rg.id, action: 'TRANSACTION_CREATED' } });
    if (after.currency === 'USD' && txs.length && logTx.createdAt < log.createdAt) raced++;
  }
  check('adding an expense during a change never gets relabelled', raced, 0);

  console.log('--- the owner leaving');
  g = await mkGroup(a, [c, b]);
  r = await leave(a, g);
  check('allowed', r.status, 200);
  check('  ownership goes to the longest-standing member', (await fresh(g)).createdById, c.id);
  check('  response shows it', r.body.createdById, c.id);
  check('  no longer a member', await db.groupMember.count({ where: { groupId: g.id, userId: a.id } }), 0);
  check('  new owner can remove people', (await request(s).delete(`/groups/${g.id}/remove/${b.id}`).set(c.h)).status < 300, true);
  check('  new owner can delete it', (await request(s).delete(`/groups/${g.id}`).set(c.h)).status < 300, true);

  g = await mkGroup(a, [b]);
  check('a member leaving keeps the owner', (await leave(b, g)).status, 200);
  check('  owner unchanged', (await fresh(g)).createdById, a.id);

  console.log('--- the last member leaving');
  r = await leave(a, g);
  check('refused', r.status, 409);
  check('  points to deleting', /delete/i.test(r.body.message), true);
  check('  still a member', await db.groupMember.count({ where: { groupId: g.id, userId: a.id } }), 1);
  check('  can delete instead', (await request(s).delete(`/groups/${g.id}`).set(a.h)).status < 300, true);

  console.log('--- leaving with debts, and not being in the group');
  g = await mkGroup(a, [b]);
  check('setup', (await addTx(a, g, { amount: 10, splits: [{ userId: b.id, amount: 10 }] })).status, 201);
  check('owner owed money can\'t leave', (await leave(a, g)).status, 403);
  check('  and keeps ownership', (await fresh(g)).createdById, a.id);
  check('outsider gets a 404', (await leave(c, g)).status, 404);
  check('leaving a missing group', (await request(s).delete(`/groups/${randomUUID()}/leave`).set(a.h)).status, 404);

  console.log('--- friending yourself');
  const fr = (u: any, to: any) => request(s).post(`/friends/requests/${to.id}`).set(u.h);
  const pairRows = (x: any, y: any) => db.friendships.findMany({ where: { OR: [{ senderId: x.id, receiverId: y.id }, { senderId: y.id, receiverId: x.id }] } });
  check('refused', (await fr(a, a)).status, 400);
  check('  nothing saved', await db.friendships.count({ where: { senderId: a.id, receiverId: a.id } }), 0);

  console.log('--- A to B and B to A');
  check('A asks B', (await fr(a, b)).status, 201);
  check('A asks again is still not an error', (await fr(a, b)).status, 201);
  check('  one row', (await pairRows(a, b)).length, 1);
  r = await fr(b, a);
  check('B asks A back', r.status, 201);
  let rows = await pairRows(a, b);
  check('  still one row', rows.length, 1);
  check('  and they are friends', rows[0].status, 'ACCEPTED');
  check('  both see it', (await request(s).get('/friends').set(a.h)).body.length, 1);
  check('asking an existing friend changes nothing', (await fr(b, a)).status, 201);
  rows = await pairRows(a, b);
  check('  one row, still accepted', `${rows.length} ${rows[0].status}`, '1 ACCEPTED');

  let extra = 0;
  for (let i = 0; i < 6; i++) {
    const [x, y] = [await mk(), await mk()];
    await Promise.all([fr(x, y), fr(y, x)]);
    if ((await pairRows(x, y)).length !== 1) extra++;
  }
  check('both asking at once never makes two rows', extra, 0);

  const raw = async (sender: any, receiver: any) => db.friendships.create({ data: { senderId: sender.id, receiverId: receiver.id } }).then(() => 'saved', () => 'refused');
  check('database refuses a reverse pair by itself', await raw(b, a), 'refused');
  check('database refuses self-friending by itself', await raw(a, a), 'refused');

  console.log('--- invitations');
  g = await mkGroup(a, [b]);
  const inv = (u: any, to: any) => request(s).post(`/groups/${g.id}/invite/${to.id}`).set(u.h);
  check('outsider can\'t invite', (await inv(c, d)).status, 403);
  check('inviting yourself', (await inv(a, a)).status, 409);
  check('inviting a member', (await inv(a, b)).status, 409);
  check('  nothing saved', await db.groupInvitation.count({ where: { groupId: g.id } }), 0);
  check('inviting someone who doesn\'t exist', (await inv(a, { id: randomUUID() })).status, 404);
  const invited = await inv(a, c);
  check('real invitation', invited.status, 201);
  await db.groupMember.create({ data: { groupId: g.id, userId: c.id } });
  r = await request(s).post(`/groups/${g.id}/invite/${invited.body.id}/accept`).set(c.h);
  check('accepting when already a member (the audit found a crash)', r.status < 300, true);
  check('  still one membership', await db.groupMember.count({ where: { groupId: g.id, userId: c.id } }), 1);

  console.log('--- creating a group with invitations');
  r = await request(s).post('/groups').set(a.h).field('name', 'New').field('currency', 'EUR').field('invite', a.id).field('invite', b.id);
  check('created', r.status, 201);
  check('  nothing failed', r.body.failedInvites, 0);
  check('  only the other person invited', await db.groupInvitation.count({ where: { groupId: r.body.id } }), 1);

  console.log('--- sending an expense twice');
  g = await mkGroup(a, [b]);
  const splits = [{ userId: a.id, amount: 5 }, { userId: b.id, amount: 5 }];
  const key = randomUUID();
  const countTx = (group = g) => db.transaction.count({ where: { groupId: group.id } });
  const first = await addTx(a, g, { splits, idempotencyKey: key });
  check('first', first.status, 201);
  const second = await addTx(a, g, { splits, idempotencyKey: key });
  check('second succeeds', second.status, 201);
  check('  same expense comes back', second.body.id, first.body.id);
  check('  one row', await countTx(), 1);
  check('  logged once', await db.activityLog.count({ where: { groupId: g.id, action: 'TRANSACTION_CREATED' } }), 1);

  const g2 = await mkGroup(a, [b]);
  const burst = randomUUID();
  const all = await Promise.all(Array.from({ length: 6 }, () => addTx(a, g2, { splits, idempotencyKey: burst })));
  check('six at once all succeed', all.filter((x) => x.status === 201).length, 6);
  check('  one row', await countTx(g2), 1);
  check('  all the same expense', new Set(all.map((x) => x.body.id)).size, 1);

  check('different key is a new expense', (await addTx(a, g, { splits, idempotencyKey: randomUUID() })).status, 201);
  check('  two rows', await countTx(), 2);
  check('no key, as older apps send', (await addTx(a, g, { splits })).status, 201);
  check('no key again', (await addTx(a, g, { splits })).status, 201);
  check('  four rows', await countTx(), 4);
  check('someone else using the same key is separate', (await addTx(b, g, { splits, paidBy: b.id, idempotencyKey: key })).status, 201);
  check('  five rows', await countTx(), 5);
  check('same key in another group is refused', (await addTx(a, g2, { splits, idempotencyKey: key })).status, 409);
  const failedKey = randomUUID();
  check('a refused expense', (await addTx(a, g, { amount: 99, splits, idempotencyKey: failedKey })).status, 403);
  check('  doesn\'t use up its key', (await addTx(a, g, { splits, idempotencyKey: failedKey })).status, 201);
  check('outsider replaying a key', (await addTx(c, g, { splits, paidBy: a.id, idempotencyKey: key })).status, 403);
  check('key too short', (await addTx(a, g, { splits, idempotencyKey: 'abc' })).status, 400);
  check('key too long', (await addTx(a, g, { splits, idempotencyKey: 'x'.repeat(65) })).status, 400);

  console.log('--- empty splits');
  check('refused', (await addTx(a, g, { splits: [] })).status, 403);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
