// End-to-end check against a disposable Postgres, using real sharp and the real CloudinaryService
// with only the SDK's network calls replaced.
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
import { Writable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
// eslint-disable-next-line
const sharp = require('sharp');

const uploads: Buffer[] = [];
const destroyed: string[] = [];
let uploadFails = false;
(cloudinary.uploader as any).upload_stream = (_o: any, cb: any) => {
  const chunks: Buffer[] = [];
  return new Writable({
    write(c, _e, done) { chunks.push(c); done(); },
    final(done) {
      if (uploadFails) cb(new Error('simulated Cloudinary failure'));
      else {
        uploads.push(Buffer.concat(chunks));
        cb(undefined, { public_id: `group/new-${uploads.length}` });
      }
      done();
    },
  });
};
(cloudinary.uploader as any).destroy = async (id: string) => { destroyed.push(id); return { result: 'ok' }; };

const { AppModule } = require(`${R}/app.module`);
const { DatabaseService } = require(`${R}/database/database.service`);
const { EmailService } = require(`${R}/email/email.service`);

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};
const solid = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 50, b: 50 } } });

(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(require('@nestjs/throttler').ThrottlerStorage).useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
    .overrideProvider(EmailService).useValue({ sendEmail: async () => ({}) })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.init();
  const s = app.getHttpServer();
  const db = mod.get(DatabaseService);

  const mk = async (name: string) => {
    const u = await db.user.create({ data: { name, email: `${name}@test.dev`, password: null } });
    return { id: u.id, h: { Authorization: `Bearer ${jwt.sign({ id: u.id }, process.env.ACCESS_TOKEN_SECRET!)}` } };
  };
  const a = await mk('alice');
  const b = await mk('bob');

  const create = (buf: Buffer, filename = 'x.jpg', contentType = 'image/jpeg') =>
    request(s).post('/groups').set(a.h).field('name', 'G').field('currency', 'EUR').attach('cover', buf, { filename, contentType });
  const groups = () => db.group.count();

  console.log('--- real images are accepted');
  const formats: [string, Buffer][] = [
    ['JPEG', await solid(50, 50).jpeg().toBuffer()],
    ['PNG', await solid(50, 50).png().toBuffer()],
    ['WebP', await solid(50, 50).webp().toBuffer()],
    ['GIF', await solid(50, 50).gif().toBuffer()],
    ['AVIF', await solid(50, 50).avif().toBuffer()],
  ];
  for (const [name, buf] of formats) {
    const r = await create(buf);
    check(name, r.status, 201);
    check('  stored', r.body.cover?.startsWith('group/new-'), true);
  }
  let r = await create(await solid(50, 50).png().toBuffer(), 'photo.heic', 'application/octet-stream');
  check('wrong declared type on a real image still works', r.status, 201);

  console.log('--- what reaches Cloudinary is re-encoded and shrunk');
  await create(await solid(4000, 3000).jpeg().toBuffer());
  const stored = await sharp(uploads[uploads.length - 1]).metadata();
  check('re-encoded as JPEG', stored.format, 'jpeg');
  check('resized to fit 1600', Math.max(stored.width, stored.height), 1600);

  console.log('--- everything else is refused');
  const before = await groups();
  const uploadsBefore = uploads.length;
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
  const refuse = async (name: string, res: any) => {
    const x = await res;
    check(name, x.status, 400);
    check('  clear message', /supported image/.test(x.body.message), true);
  };
  await refuse('SVG declared as JPEG', create(svg));
  await refuse('text declared as JPEG', create(Buffer.from('not an image at all')));
  await refuse('PDF declared as JPEG', create(Buffer.from('%PDF-1.7 fake')));
  await refuse('HTML', create(Buffer.from('<html><script>alert(1)</script></html>'), 'x.html', 'text/html'));
  await refuse('TIFF', create(await solid(50, 50).tiff().toBuffer()));
  await refuse('empty file', create(Buffer.alloc(0)));
  const jpeg = await solid(1000, 1000).jpeg().toBuffer();
  await refuse('truncated image', create(jpeg.subarray(0, Math.floor(jpeg.length / 2))));
  check('no groups created', await groups(), before);
  check('nothing uploaded', uploads.length, uploadsBefore);

  console.log('--- size limits');
  r = await create(Buffer.alloc(16 * 1024 * 1024, 1));
  check('16 MB refused', r.status, 413);
  check('  no group created', await groups(), before);
  const bomb = await solid(11000, 11000).png({ compressionLevel: 9 }).toBuffer();
  check('  test file really is small', bomb.length < 15 * 1024 * 1024, true);
  r = await create(bomb);
  check(`${Math.round(bomb.length / 1024)} KB file that decodes to 121 megapixels refused`, r.status, 400);
  r = await request(s).post('/groups').set(a.h).field('name', 'G').field('currency', 'EUR')
    .attach('cover', formats[0][1], 'a.jpg').attach('cover', formats[0][1], 'b.jpg');
  check('two files refused', r.status, 400);
  r = await request(s).post('/groups').set(a.h).field('name', 'G').field('currency', 'EUR').field('name2', 'x'.repeat(70 * 1024));
  check('oversized text field refused', r.status >= 400, true);
  const inv = await mk('invitee');
  const multi = request(s).post('/groups').set(a.h).field('name', 'G').field('currency', 'EUR');
  for (let i = 0; i < 40; i++) multi.field('invite', inv.id);
  check('creating a group with many invites still works', (await multi).status, 201);

  console.log('--- updating a cover never loses the old one');
  const G = (await request(s).post('/groups').set(a.h).field('name', 'G').field('currency', 'EUR')).body.id;
  await db.group.update({ where: { id: G }, data: { cover: 'group/old' } });
  await db.groupMember.create({ data: { groupId: G, userId: b.id } });
  const cover = async () => (await db.group.findUnique({ where: { id: G } })).cover;
  const patch = (buf?: Buffer, u = a) => {
    const q = request(s).patch(`/groups/${G}`).set(u.h).field('name', 'G').field('currency', 'EUR');
    return buf ? q.attach('cover', buf, { filename: 'x.jpg', contentType: 'image/jpeg' }) : q;
  };
  destroyed.length = 0;
  r = await patch(Buffer.from('junk'));
  check('bad image refused (was an empty 200)', r.status, 400);
  check('  old cover still set', await cover(), 'group/old');
  check('  old file not deleted (was lost)', destroyed.length, 0);
  uploadFails = true;
  r = await patch(formats[0][1]);
  uploadFails = false;
  check('Cloudinary failing is an error (was an empty 200)', r.status, 500);
  check('  old cover still set', await cover(), 'group/old');
  check('  old file not deleted (was lost)', destroyed.length, 0);
  const realUpdate = db.$transaction;
  db.$transaction = () => Promise.reject(new Error('simulated database failure'));
  r = await patch(formats[0][1]);
  db.$transaction = realUpdate;
  check('database failing is an error', r.status, 500);
  check('  old cover still set', await cover(), 'group/old');
  check('  old file kept, new upload cleaned up', destroyed.length === 1 && destroyed[0].startsWith('group/new-'), true);
  destroyed.length = 0;
  r = await patch(formats[0][1]);
  check('good image', r.status, 200);
  check('  new cover set', (await cover()).startsWith('group/new-'), true);
  check('  old file deleted afterwards', destroyed.join(), 'group/old');
  const out = await mk('outsider');
  check('non-member gets 404 (was an empty 200)', (await patch(formats[0][1], out)).status, 404);
  destroyed.length = 0;
  const current = await cover();
  r = await request(s).patch(`/groups/${G}`).set(a.h).field('name', 'G').field('currency', 'EUR').field('removeCover', 'true');
  check('removing a cover', r.status, 200);
  check('  cleared', await cover(), null);
  check('  file deleted', destroyed.join(), current);
  r = await patch();
  check('name-only update still works', r.status, 200);

  console.log('--- creating: cleaned up if saving fails');
  destroyed.length = 0;
  const realCreate = db.$transaction;
  db.$transaction = () => Promise.reject(new Error('simulated database failure'));
  r = await create(formats[0][1]);
  db.$transaction = realCreate;
  check('error returned', r.status, 500);
  check('  upload removed', destroyed.length === 1 && destroyed[0].startsWith('group/new-'), true);

  await app.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
