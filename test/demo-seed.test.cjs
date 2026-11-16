// The one-time seed must finish after an interrupted earlier run instead of failing on the
// accounts and course that run already created (LT-575, CodeRabbit review).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const users = [
  { username: 'demo-alex', password: 'p'.repeat(32), email: 'alex@demo.invalid', first: 'Alex', last: 'Demo' },
  { username: 'demo-sam', password: 'q'.repeat(32), email: 'sam@demo.invalid', first: 'Sam', last: 'Demo' },
];

// Minimal stand-in for the native NB routes the seed calls, with the same status codes.
function fakeNb() {
  const state = { users: new Map(), classes: [], members: new Set(), files: [], calls: [] };
  const tokenFor = u => `x.${Buffer.from(JSON.stringify({ user: { id: u.id } })).toString('base64url')}.y`;
  const userOf = req => {
    const m = /^Bearer x\.([^.]+)\.y$/.exec(req.headers.authorization || '');
    return m && JSON.parse(Buffer.from(m[1], 'base64url').toString()).user;
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const url = new URL(req.url, 'http://x');
      const send = (code, json) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      state.calls.push(`${req.method} ${url.pathname}`);
      const me = userOf(req);
      if (url.pathname === '/api/users/register') {
        if (state.users.has(body.username)) return send(400, { msg: 'username must be unique' });
        state.users.set(body.username, { id: `u-${body.username}`, password: body.password });
        return send(200, { msg: 'registered' });
      }
      if (url.pathname === '/api/users/login') {
        const u = state.users.get(body.username);
        if (!u || u.password !== body.password) return send(401, { msg: 'no' });
        return send(200, { token: tokenFor(u) });
      }
      if (!me) return send(401, null);
      if (url.pathname === '/api/classes/instructor') return send(200, state.classes.filter(c => c.owner === me.id));
      if (url.pathname === '/api/classes/create') {
        const c = { id: `c${state.classes.length + 1}`, class_name: body.name, owner: me.id };
        state.classes.push(c);
        return send(200, c);
      }
      let m;
      if ((m = /^\/api\/classes\/student\/(.+)$/.exec(url.pathname))) { state.members.add(`${m[1]}:${body.id}`); return send(200, null); }
      if ((m = /^\/api\/files\/class\/(.+)$/.exec(url.pathname))) return send(200, { id: `f-${m[1]}` });
      if ((m = /^\/api\/files\/folder\/(.+)$/.exec(url.pathname))) {
        return send(200, state.files.filter(f => f.parent === m[1]).map(f => ({ id: f.id, filename: f.name, Source: { filepath: f.url } })));
      }
      if ((m = /^\/api\/files\/file\/(.+)$/.exec(url.pathname))) {
        const f = { id: `file${state.files.length + 1}`, parent: m[1], name: body.name, url: body.url };
        state.files.push(f);
        return send(200, { id: f.id });
      }
      if (url.pathname === '/api/annotations/myClasses') {
        return send(200, state.classes.filter(c => c.owner === me.id || state.members.has(`${c.id}:${me.id}`)).map(c => ({ id: c.id })));
      }
      send(404, null);
    });
  });
  return { server, state };
}

function runSeed(port, operatorDir) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'demo-seed.cjs')], {
      env: { ...process.env, NB_DEMO_OPERATOR_DIR: operatorDir, NB_DEMO_ORIGIN: 'https://nb.libretexts.dev', NB_DEMO_PORT: String(port) },
    });
    let stderr = '';
    child.stderr.on('data', c => { stderr += c; });
    child.on('exit', status => resolve({ status, stderr }));
  });
}

test('an interrupted seed resumes without duplicating accounts, course or reading', async () => {
  const { server, state } = fakeNb();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-demo-seed-'));
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ users }));
    // Earlier run: first account registered and course created, then it stopped before the receipt.
    state.users.set(users[0].username, { id: 'u-demo-alex', password: users[0].password });
    state.classes.push({ id: 'c1', class_name: 'Nota Bene native demo', owner: 'u-demo-alex' });
    const { status, stderr } = await runSeed(server.address().port, dir);
    assert.equal(status, 0, stderr);
    assert.equal(state.classes.length, 1, 'reuses the course the interrupted run created');
    assert.equal(state.files.length, 1);
    assert.deepEqual(state.calls.filter(c => c === 'POST /api/users/register'), ['POST /api/users/register'], 'registers only the missing account');
    const fixture = JSON.parse(fs.readFileSync(path.join(dir, 'fixture.json'), 'utf8'));
    assert.equal(fixture.courseId, 'c1');
    assert.deepEqual(fixture.users, ['u-demo-alex', 'u-demo-sam']);
    // A completed seed still refuses to run again.
    const again = await runSeed(server.address().port, dir);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists/);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
