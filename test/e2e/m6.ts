// End-to-end check of what the API accepts. The real app and real validation; only email
// delivery is replaced. Postgres is disposable.
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
const long = (n: number) => 'x'.repeat(n);

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

  const mk = async (email: string, name = email) => db.user.create({ data: { name, email, emailVerified: true } });
  const auth = (id: string, role?: string) => ({ Authorization: `Bearer ${jwt.sign({ id, ...(role && { role }) }, process.env.ACCESS_TOKEN_SECRET!)}` });
  const alice = await mk('alice@test.dev');
  const bob = await mk('bob@test.dev');
  const A = auth(alice.id);
  const ADMIN = auth(alice.id, 'ADMIN');
  for (let i = 0; i < 8; i++) await mk(`findme${i}@test.dev`, `Findme ${i}`);

  const get = (url: string, h: any = A) => request(s).get(url).set(h);
  const post = (url: string, body: any, h: any = A) => request(s).post(url).set(h).send(body);
  const patch = (url: string, body: any, h: any = A) => request(s).patch(url).set(h).send(body);
  const makeGroup = (name: any, currency: any) => {
    const r = request(s).post('/groups').set(A);
    return r.field('name', name).field('currency', currency);
  };

  console.log('--- device tokens: these used to reach the database unchecked');
  check('empty body', (await post('/devices', {})).status, 400);
  check('token not a string', (await post('/devices', { token: { a: 1 }, platform: 'ios' })).status, 400);
  check('unknown platform', (await post('/devices', { token: 'ExponentPushToken[a]', platform: 'nokia' })).status, 400);
  check('oversized token', (await post('/devices', { token: long(513), platform: 'ios' })).status, 400);
  check('real ios token', (await post('/devices', { token: 'ExponentPushToken[abc]', platform: 'ios' })).status, 201);
  check('real android token', (await post('/devices', { token: 'ExponentPushToken[def]', platform: 'android' })).status, 201);

  console.log('--- admin activity paging');
  check('no paging given uses defaults', (await get('/admin/activites', ADMIN)).status, 200);
  for (const q of ['page=-5&limit=25', 'page=1&limit=0', 'page=1&limit=abc', 'page=1.5&limit=25', 'page=1&limit=501', 'page=1e30&limit=25'])
    check(`refuses ${q}`, (await get(`/admin/activites?${q}`, ADMIN)).status, 400);
  for (const limit of [25, 50, 100, 250, 500]) {
    const r = await get(`/admin/activites?page=1&limit=${limit}`, ADMIN);
    check(`admin table's page size ${limit}`, `${r.status} ${r.body.meta?.limit}`, `200 ${limit}`);
  }
  check('last possible page does not crash', (await get('/admin/activites?page=1000000&limit=500', ADMIN)).status, 200);
  check('still admin only', (await get('/admin/activites?page=1&limit=25')).status, 403);

  console.log('--- admin ids and bug reports');
  const bug = await db.bugReport.create({ data: { title: 'A bug', description: 'Something broke' } });
  check('bad status', (await patch(`/admin/bugs/${bug.id}`, { status: 'NOPE' }, ADMIN)).status, 400);
  check('bad severity', (await patch(`/admin/bugs/${bug.id}`, { severity: 'NOPE' }, ADMIN)).status, 400);
  check('nothing to change', (await patch(`/admin/bugs/${bug.id}`, {}, ADMIN)).status, 400);
  check('status alone, as the admin app sends', (await patch(`/admin/bugs/${bug.id}`, { status: 'CLOSED' }, ADMIN)).status, 200);
  check('severity alone, as the admin app sends', (await patch(`/admin/bugs/${bug.id}`, { severity: 'MAJOR' }, ADMIN)).status, 200);
  const saved = await db.bugReport.findUnique({ where: { id: bug.id } });
  check('  both saved', `${saved.status} ${saved.severity}`, 'CLOSED MAJOR');
  check('bad bug id', (await patch('/admin/bugs/nope', { status: 'OPEN' }, ADMIN)).status, 400);
  check('bad id on delete bug', (await request(s).delete('/admin/bugs/nope').set(ADMIN)).status, 400);
  check('bad id on update user', (await patch('/admin/users/nope', { password: 'long-enough-1' }, ADMIN)).status, 400);
  check('bad id on delete user', (await request(s).delete('/admin/users/nope').set(ADMIN)).status, 400);

  console.log('--- user search paging: the audit found ?limit=5 was always refused');
  const search = (q: string) => get(`/users/search?${q}`);
  let r = await search('query=findme&limit=5');
  check('limit works', `${r.status} ${r.body.length}`, '200 5');
  const page1 = await search('query=findme&limit=3&offset=0');
  const page2 = await search('query=findme&limit=3&offset=3');
  check('offset moves on', page1.body[0]?.id !== page2.body[0]?.id && page2.body.length === 3, true);
  r = await search('query=findme');
  check('defaults to 10', `${r.status} ${r.body.length}`, '200 8');
  for (const q of ['limit=0', 'limit=-1', 'limit=51', 'limit=abc', 'offset=-1', 'offset=1.5'])
    check(`refuses ${q}`, (await search(`query=findme&${q}`)).status, 400);
  check('no query', (await search('')).status, 400);
  check('query as an object', (await search('query[a]=b')).status, 400);
  check('oversized query', (await search(`query=${long(101)}`)).status, 400);

  console.log('--- activity feed paging');
  check('no page', (await get('/activity-logs')).status, 200);
  check('page 2', (await get('/activity-logs?page=2')).status, 200);
  for (const q of ['page=-5', 'page=0', 'page=1.5', 'page=abc', 'page=1e30'])
    check(`refuses ${q}`, (await get(`/activity-logs?${q}`)).status, 400);

  console.log('--- currency: a bad code throws when the clients format an amount');
  for (const c of ['FAKE!', 'eur', 'XYZ', '', 'EURO'])
    check(`refuses "${c}"`, (await makeGroup('Trip', c)).status, 400);
  for (const c of ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'ALL'])
    check(`accepts ${c}`, (await makeGroup(`Trip ${c}`, c)).status, 201);
  const group = (await makeGroup('  Spaced name  ', 'EUR')).body;
  check('name is trimmed', group.name, 'Spaced name');
  const update = (name: string, currency: string) => request(s).patch(`/groups/${group.id}`).set(A).field('name', name).field('currency', currency);
  check('update refuses bad currency', (await update('Trip', 'FAKE!')).status, 400);
  check('update accepts real currency', (await update('Trip', 'USD')).status, 200);

  console.log('--- text limits');
  check('blank group name', (await makeGroup('   ', 'EUR')).status, 400);
  check('group name at the limit', (await makeGroup(long(100), 'EUR')).status, 201);
  check('group name over it', (await makeGroup(long(101), 'EUR')).status, 400);
  check('NUL byte in a name, which Postgres can\'t store', (await post('/auth/update-profile', { name: 'a\0b' })).status, 400);
  check('blank user name', (await post('/auth/update-profile', { name: '  ' })).status, 400);
  check('long user name', (await post('/auth/update-profile', { name: long(101) })).status, 400);
  check('normal user name', (await post('/auth/update-profile', { name: 'Alice Smith' })).status, 201);
  const reg = (over: any) => post('/auth/register', { name: 'New Person', email: 'new@test.dev', password: 'long-enough-1', confirmPassword: 'long-enough-1', ...over }, {});
  check('register: blank name', (await reg({ name: ' ' })).status, 400);
  check('register: long email', (await reg({ email: `${long(250)}@test.dev` })).status, 400);
  check('register: normal', (await reg({})).status, 201);

  console.log('--- transactions');
  await db.groupMember.create({ data: { groupId: group.id, userId: bob.id } });
  const tx = (description: any) => post('/transactions', { groupId: group.id, amount: 10, category: 'FOOD', description, paidBy: alice.id, splits: [{ userId: alice.id, amount: 5 }, { userId: bob.id, amount: 5 }] });
  check('description at the limit', (await tx(long(255))).status, 201);
  check('description over it', (await tx(long(256))).status, 400);
  check('NUL byte', (await tx('Lunch\0')).status, 400);
  check('normal', (await tx('Lunch out')).status, 201);
  const settle = (description: any) => post('/transactions/settle', { groupId: group.id, amount: 1, description, paidBy: bob.id });
  check('settle description over the limit', (await settle(long(256))).status, 400);

  console.log('--- tasks');
  const tasks = `/groups/${group.id}/tasks`;
  check('blank text', (await post(tasks, { text: '  ' })).status, 400);
  check('over the limit', (await post(tasks, { text: long(501) })).status, 400);
  const t1 = (await post(tasks, { text: long(500) }));
  check('at the limit', t1.status, 201);
  const t2 = await post(tasks, { text: 'Book tickets' });
  check('update: blank text', (await patch(`${tasks}/${t1.body.id}`, { text: ' ' })).status, 400);
  check('update: done alone', (await patch(`${tasks}/${t1.body.id}`, { done: true })).status, 200);
  check('update: bad task id', (await patch(`${tasks}/nope`, { done: true })).status, 400);
  const reorder = (orderedIds: any) => request(s).put(`${tasks}/reorder`).set(A).send({ orderedIds });
  check('reorder: not ids', (await reorder(['nope'])).status, 400);
  check('reorder: real ids', (await reorder([t2.body.id, t1.body.id])).status, 200);

  console.log('--- bug reports');
  const report = (over: any) => post('/bug-reports', { title: 'It broke', description: 'It broke when I clicked', ...over });
  check('title over the limit', (await report({ title: long(201) })).status, 400);
  check('description over the limit', (await report({ description: long(5001) })).status, 400);
  check('name over the limit', (await report({ name: long(101) })).status, 400);
  check('device over the limit', (await report({ device: long(501) })).status, 400);
  check('blank name and email, as the web form sends', (await report({ name: '', email: '', device: 'Chrome' })).status, 201);
  check('bad email', (await report({ email: 'nope' })).status, 400);
  check('browser user agent fits', (await report({ device: long(300), email: 'a@test.dev', name: 'Al' })).status, 201);

  console.log('--- auth inputs');
  check('verify-reset-token with no token', (await get('/auth/verify-reset-token', {})).status, 400);
  check('verify-reset-token with an object', (await get('/auth/verify-reset-token?token[a]=b', {})).status, 400);
  check('verify-reset-token with a bad token', (await get('/auth/verify-reset-token?token=abc', {})).status, 401);
  check('code in the wrong format', (await post('/auth/verify-email/verify', { email: 'alice@test.dev', otp: 'abc' }, {})).status, 400);
  check('code in the right format', (await post('/auth/verify-email/verify', { email: 'alice@test.dev', otp: '123456' }, {})).body.verified, false);
  check('refresh with an object', (await post('/auth/refresh', { refreshToken: { a: 1 } }, {})).status, 403);
  check('refresh with nothing', (await post('/auth/refresh', {}, {})).status, 403);
  check('logout with an object is harmless', (await post('/auth/logout', { refreshToken: { a: 1 } }, {})).status, 200);

  console.log('--- ids in the path');
  check('group id', (await get('/groups/nope')).status, 400);
  check('leave group id', (await request(s).delete('/groups/nope/leave').set(A)).status, 400);
  check('real group still opens', (await get(`/groups/${group.id}`)).status, 200);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
