// End-to-end check of the real build: runs dist/main as its own process, the way production
// does, because helmet, shutdown and logging only exist there. Postgres is disposable.
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('refusing to run outside the throwaway database');

import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';

const P = path.resolve(__dirname, '../..');
const SECRET = 'audit-access-secret-for-tests-only-0123456789';

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const start = async (nodeEnv: string, port: number) => {
  let output = '';
  const child = spawn('node', [path.join(P, 'dist/src/main')], {
    cwd: P,
    env: {
      ...process.env,
      NODE_ENV: nodeEnv,
      PORT: String(port),
      ACCESS_TOKEN_SECRET: SECRET,
      RESET_PASSWORD_SECRET: 'audit-reset-secret-for-tests-only-0123456789',
    },
  });
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  let exit: { code: number | null; signal: string | null } | undefined;
  const exited = new Promise<void>((resolve) => child.on('exit', (code, signal) => { exit = { code, signal }; resolve(); }));
  for (let i = 0; i < 100; i++) {
    const up = await fetch(`http://127.0.0.1:${port}/auth/refresh`).catch(() => null);
    if (up) break;
    await sleep(100);
  }
  return { child, exited, output: () => output, exit: () => exit };
};

(async () => {
  const base = 'http://127.0.0.1:39811';
  const app = await start('production', 39811);
  const bearer = (id: string, opts: any = {}) => ({ Authorization: `Bearer ${jwt.sign({ id }, SECRET, opts)}` });

  console.log('--- security headers');
  let r = await fetch(`${base}/auth/refresh`);
  check('X-Powered-By is gone', r.headers.get('x-powered-by'), null);
  check('nosniff', r.headers.get('x-content-type-options'), 'nosniff');
  check('HSTS', !!r.headers.get('strict-transport-security'), true);
  check('frames refused', !!r.headers.get('x-frame-options'), true);

  console.log('--- the web and admin apps can still call it');
  r = await fetch(`${base}/auth/refresh`, { headers: { Origin: 'https://web.test' } });
  check('allowed origin', r.headers.get('access-control-allow-origin'), 'https://web.test');
  check('  with cookies', r.headers.get('access-control-allow-credentials'), 'true');
  check('  not blocked by resource policy', r.headers.get('cross-origin-resource-policy'), 'cross-origin');
  r = await fetch(`${base}/auth/refresh`, { headers: { Origin: 'https://evil.test' } });
  check('other origin', r.headers.get('access-control-allow-origin'), null);

  console.log('--- health check');
  r = await fetch(`${base}/health`);
  check('up', r.status, 200);
  check('  says so', (await r.json().catch(() => ({})))?.status, 'ok');
  const many = await Promise.all(Array.from({ length: 320 }, () => fetch(`${base}/health`).then((x) => x.status)));
  check('platform polling is never rate limited', many.filter((x) => x === 429).length, 0);

  console.log('--- amounts still serialize as numbers (main.ts sets this up)');
  r = await fetch(`${base}/auth/profile`, { headers: bearer('00000000-0000-0000-0000-000000000000') });
  check('account that doesn\'t exist', r.status, 401);

  console.log('--- logs');
  const before = app.output().length;
  await fetch(`${base}/auth/profile`, { headers: bearer('00000000-0000-0000-0000-000000000000', { expiresIn: -10 }) });
  await sleep(200);
  check('an expired token writes nothing to the logs', app.output().slice(before).length, 0);
  const lines = app.output().split('\n').filter(Boolean);
  check('there are startup logs', lines.length > 0, true);
  const parsed = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } });
  check('every line is JSON in production', parsed.filter((l) => !l).length, 0);
  check('  with a level', typeof parsed[0]?.level, 'string');
  check('  a time', !isNaN(Date.parse(parsed[0]?.time)), true);
  check('  and a message', typeof parsed[0]?.message, 'string');

  console.log('--- shutting down with a live event stream open');
  const db = process.env.DATABASE_URL!;
  const uid = execSync(`docker exec fairshare-audit-pg psql -At -U audit -d audit -c "INSERT INTO \\"User\\"(id,name,email,\\"updatedAt\\",\\"emailVerified\\") VALUES (gen_random_uuid()::text,'S','s${Date.now()}@test.dev',now(),true) RETURNING id"`).toString().split('\n')[0].trim();
  r = await fetch(`${base}/sse/ticket`, { method: 'POST', headers: bearer(uid) });
  check('setup: ticket', r.status, 201);
  const { ticket } = await r.json();
  const stream = await fetch(`${base}/sse/subscribe?ticket=${ticket}`).catch((e) => e);
  check('setup: stream open', stream.status, 200);
  const reader = stream.body.getReader();
  const ended = (async () => {
    try {
      while (!(await reader.read()).done);
      return true;
    } catch {
      return 'cut off';
    }
  })();
  const t0 = Date.now();
  app.child.kill('SIGTERM');
  const quit = await Promise.race([app.exited.then(() => true), sleep(8000).then(() => false)]);
  check('exits on its own, not waiting for the platform to kill it', quit, true);
  check('  quickly', Date.now() - t0 < 5000, true);
  check('  the stream was closed properly, not cut off', await Promise.race([ended, sleep(500).then(() => 'still open')]), true);
  if (!quit) app.child.kill('SIGKILL');
  void db;

  console.log('--- shutting down with requests in progress');
  const busy = await start('production', 39814);
  // Password checks are slow enough to still be running when the signal arrives
  const inFlight = Array.from({ length: 8 }, () =>
    fetch('http://127.0.0.1:39814/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@test.dev', password: 'wrong-password' }),
    }).then((x) => x.status, () => 'cut off'),
  );
  await sleep(15);
  busy.child.kill('SIGTERM');
  const answers = await Promise.all(inFlight);
  check('every one gets its answer', answers.filter((x) => x === 401).length, 8);
  await Promise.race([busy.exited, sleep(5000)]);
  check('  and it still exits', !!busy.exit(), true);
  busy.child.kill('SIGKILL');

  console.log('--- development keeps readable logs');
  const dev = await start('development', 39812);
  const devLines = dev.output().split('\n').filter(Boolean);
  check('not JSON', devLines.some((l) => { try { JSON.parse(l); return true; } catch { return false; } }), false);
  dev.child.kill('SIGTERM');
  await Promise.race([dev.exited, sleep(5000)]);
  dev.child.kill('SIGKILL');

  console.log('--- database down');
  const down = await start('production', 39813);
  execSync('docker stop -t 1 fairshare-audit-pg', { stdio: 'ignore' });
  r = await fetch('http://127.0.0.1:39813/health');
  check('health check reports it', r.status, 503);
  const body = await r.text();
  check('  with no details', /postgres|prisma|55432|audit/i.test(body), false);
  down.child.kill('SIGTERM');
  await Promise.race([down.exited, sleep(5000)]);
  down.child.kill('SIGKILL');

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
