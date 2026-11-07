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

const P = require('path').resolve(__dirname, '../..');
const R = `${P}/src`;
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { Expo } from 'expo-server-sdk';

(Expo.prototype as any).sendPushNotificationsAsync = async () => [];

const { AppModule } = require(`${R}/app.module`);
const { DatabaseService } = require(`${R}/database/database.service`);
const { EmailService } = require(`${R}/email/email.service`);
const { CloudinaryService } = require(`${R}/cloudinary/cloudinary.service`);
const { GoogleStrategy } = require(`${R}/auth/google.strategy`);

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};
const noToken = (name: string, body: any) => check(`${name} hides inviteToken`, JSON.stringify(body ?? null).includes('inviteToken'), false);

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
  process.chdir(P); // renderTemplate reads templates/ relative to cwd

  const mkUser = async (name: string, password: string | null = 'x') => {
    const u = await db.user.create({ data: { name, email: `${name}@test.dev`, password: password === null ? null : await bcrypt.hash(password, 4) } });
    return { id: u.id, h: { Authorization: `Bearer ${jwt.sign({ id: u.id }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const owner = await mkUser('owner');
  const member = await mkUser('member');
  const outsider = await mkUser('outsider');
  const invitee = await mkUser('invitee');

  console.log('--- token never leaks');
  let r = await request(s).post('/groups').set(owner.h).field('name', 'Trip').field('currency', 'EUR');
  check('create group', r.status, 201);
  noToken('POST /groups', r.body);
  const G = r.body.id;
  const row = await db.group.findUnique({ where: { id: G }, select: { inviteToken: true } });
  const dbToken = row.inviteToken;
  check('created group has a token in the database', /^[0-9a-f-]{36}$/.test(dbToken), true);
  noToken('GET /groups', (await request(s).get('/groups').set(owner.h)).body);
  noToken('GET /groups/:id', (await request(s).get(`/groups/${G}`).set(owner.h)).body);
  noToken('GET /auth/profile (nested)', (await request(s).get('/auth/profile').set(owner.h)).body);

  console.log('--- invite link endpoint');
  r = await request(s).get(`/groups/${G}/invite-link`).set(owner.h);
  check('owner gets token', r.body.token, dbToken);
  check('owner canReset', r.body.canReset, true);
  check('outsider cannot read link', (await request(s).get(`/groups/${G}/invite-link`).set(outsider.h)).status, 404);

  console.log('--- joining');
  const isMember = async (u: any) => !!(await db.groupMember.findUnique({ where: { groupId_userId: { groupId: G, userId: u.id } } }));
  check('old POST /groups/:id/join is gone', (await request(s).post(`/groups/${G}/join`).set(outsider.h)).status, 404);
  check('group ID does not work as a token', (await request(s).post(`/groups/join/${G}`).set(outsider.h)).status, 404);
  check('unknown token', (await request(s).post('/groups/join/99999999-9999-4999-8999-999999999999').set(outsider.h)).status, 404);
  check('malformed token', (await request(s).post('/groups/join/nope').set(outsider.h)).status, 400);
  check('outsider still not a member', await isMember(outsider), false);
  r = await request(s).post(`/groups/join/${dbToken}`).set(member.h);
  check('join with token', r.status, 201);
  check('response has group id for redirect', r.body.id, G);
  noToken('POST /groups/join/:token', r.body);
  check('is now a member', await isMember(member), true);
  const logs = () => db.activityLog.count({ where: { groupId: G, action: 'GROUP_MEMBER_JOINED' } });
  check('one join logged', await logs(), 1);
  r = await request(s).post(`/groups/join/${dbToken}`).set(member.h);
  check('joining twice is harmless', r.status, 201);
  check('  returns group id', r.body.id, G);
  noToken('repeat join', r.body);
  check('  not logged twice', await logs(), 1);
  r = await request(s).get(`/groups/${G}/invite-link`).set(member.h);
  check('member gets token', r.body.token, dbToken);
  check('member cannot reset (flag)', r.body.canReset, false);
  check('member cannot reset (endpoint)', (await request(s).post(`/groups/${G}/invite-link/reset`).set(member.h)).status, 403);

  console.log('--- invitations against real data');
  check('non-member cannot invite themselves', (await request(s).post(`/groups/${G}/invite/${outsider.id}`).set(outsider.h)).status, 403);
  r = await request(s).post(`/groups/${G}/invite/${invitee.id}`).set(owner.h);
  check('owner invites', r.status, 201);
  noToken('invite response', r.body);
  const inviteId = r.body.id;
  check("outsider accepts someone else's invite", (await request(s).post(`/groups/${G}/invite/${inviteId}/accept`).set(outsider.h)).status, 404);
  check('  outsider not added', await isMember(outsider), false);
  check('  invite still pending', (await db.groupInvitation.findUnique({ where: { id: inviteId } })).status, 'PENDING');
  check('fake invite ID', (await request(s).post(`/groups/${G}/invite/99999999-9999-4999-8999-999999999999/accept`).set(outsider.h)).status, 404);
  check('  outsider not added', await isMember(outsider), false);
  check("outsider rejects someone else's invite", (await request(s).post(`/groups/invite/${inviteId}/reject`).set(outsider.h)).status, 404);
  check('  invite still exists', !!(await db.groupInvitation.findUnique({ where: { id: inviteId } })), true);
  r = await request(s).post(`/groups/${G}/invite/${inviteId}/accept`).set(invitee.h);
  check('receiver accepts', r.status, 201);
  noToken('accept response', r.body);
  check('  receiver added', await isMember(invitee), true);
  check('accepting twice', (await request(s).post(`/groups/${G}/invite/${inviteId}/accept`).set(invitee.h)).status, 404);
  const late = await mkUser('late');
  r = await request(s).post(`/groups/${G}/invite/${late.id}`).set(owner.h);
  await request(s).post(`/groups/join/${dbToken}`).set(late.h);
  check('accepting after joining by link', (await request(s).post(`/groups/${G}/invite/${r.body.id}/accept`).set(late.h)).status, 201);
  const reject = await mkUser('rejecter');
  r = await request(s).post(`/groups/${G}/invite/${reject.id}`).set(owner.h);
  check('receiver rejects', (await request(s).post(`/groups/invite/${r.body.id}/reject`).set(reject.h)).status, 201);

  console.log('--- removal and reset');
  r = await request(s).delete(`/groups/${G}/remove/${member.id}`).set(owner.h);
  check('owner removes member', r.status, 200);
  noToken('remove response', r.body);
  check('removed member gone', await isMember(member), false);
  check('removed member blocked from old link', (await request(s).post(`/groups/join/${dbToken}`).set(member.h)).status, 404);
  check('removed member cannot read link', (await request(s).get(`/groups/${G}/invite-link`).set(member.h)).status, 404);
  const t2 = (await request(s).get(`/groups/${G}/invite-link`).set(owner.h)).body.token;
  check('token changed on removal', t2 !== dbToken, true);
  r = await request(s).post(`/groups/${G}/invite-link/reset`).set(owner.h);
  check('owner resets', r.status, 201);
  const t3 = r.body.token;
  check('reset returns a new token', t3 !== t2, true);
  check('previous link dead', (await request(s).post(`/groups/join/${t2}`).set(outsider.h)).status, 404);
  check('new link works', (await request(s).post(`/groups/join/${t3}`).set(outsider.h)).status, 201);
  const logRows = await db.activityLog.findMany({ where: { groupId: G } });
  noToken('stored activity snapshots', logRows);
  noToken('GET /activity-logs', (await request(s).get('/activity-logs').set(owner.h)).body);

  console.log('--- C1 on real data');
  const google = await mod.get(GoogleStrategy).validate('', '', { emails: [{ value: 'g@test.dev', verified: true }], displayName: 'G' });
  const rawG = await db.user.findUnique({ where: { id: google.id }, omit: { password: false } });
  check('new Google user has NULL password', rawG.password, null);
  const login = (email: string, password: string) => request(s).post('/auth/login').send({ email, password });
  check('Google user, empty password', (await login('g@test.dev', '')).status, 400);
  check('Google user, NUL password', (await login('g@test.dev', '\0')).status, 400);
  check('Google user, any password', (await login('g@test.dev', 'guess')).status, 401);
  check('normal user login still works', (await login('owner@test.dev', 'x')).status, 200);
  await db.user.create({ data: { name: 'legacy', email: 'legacy@test.dev', provider: 'google', password: await bcrypt.hash('', 4) } });
  await db.user.create({ data: { name: 'legacyset', email: 'set@test.dev', provider: 'google', password: await bcrypt.hash('own', 4) } });
  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
