// Creates the two synthetic demo accounts, course, membership and reading through
// native NB APIs on the loopback listener (public registration is closed at the proxy).
// Run once on the host as the operator. It never creates annotations or replies.
// An interrupted run can be repeated: it signs in to accounts that already exist and reuses
// the demo course and reading; only a completed run (fixture.json) refuses to run again.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { parseOrigin } = require('./demo-config.cjs');

const operatorDir = process.env.NB_DEMO_OPERATOR_DIR;
if (!operatorDir || !path.isAbsolute(operatorDir)) throw new Error('Set absolute NB_DEMO_OPERATOR_DIR.');
const origin = parseOrigin(process.env.NB_DEMO_ORIGIN);
const port = Number(process.env.NB_DEMO_PORT);
if (!/^\d+$/.test(process.env.NB_DEMO_PORT || '') || port < 1024 || port > 65535) throw new Error('Set NB_DEMO_PORT.');
const receipt = path.join(operatorDir, 'fixture.json');
if (fs.existsSync(receipt)) throw new Error('Demo fixture already exists. Restart without reseeding.');
const settings = JSON.parse(fs.readFileSync(path.join(operatorDir, 'settings.json'), 'utf8'));
assert.equal(settings.users?.length, 2, 'settings.json must list exactly two synthetic accounts');
for (const user of settings.users) assert.match(user.email, /@demo\.invalid$/, 'demo accounts use reserved .invalid email');

function request(method, pathname, body, token, allowed = [200]) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (!allowed.includes(res.statusCode)) return reject(new Error(`${method} ${pathname.split('?')[0]}: HTTP ${res.statusCode}`));
        if (res.statusCode !== 200) return resolve({ status: res.statusCode });
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Invalid JSON at ${pathname.split('?')[0]}`)); }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('Local request timeout')));
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

const courseName = 'Nota Bene native demo';

async function signIn(user) {
  const login = () => request('POST', '/api/users/login', { username: user.username, password: user.password }, null, [200, 401]);
  let result = await login();
  if (result.status === 401) {
    await request('POST', '/api/users/register', user);
    result = await login();
  }
  if (!result.token) throw new Error(`POST /api/users/login: HTTP ${result.status}`);
  const actor = JSON.parse(Buffer.from(result.token.split('.')[1], 'base64url').toString()).user;
  return { id: actor.id, token: result.token };
}

async function seed() {
  const accounts = [];
  for (const user of settings.users) accounts.push(await signIn(user));
  const owned = await request('GET', '/api/classes/instructor', null, accounts[0].token);
  const course = owned.find(item => item.class_name === courseName)
    || await request('POST', '/api/classes/create', { name: courseName }, accounts[0].token);
  assert.ok(course.id);
  await request('POST', `/api/classes/student/${course.id}`, { id: accounts[1].id }, accounts[0].token);
  const folder = await request('GET', `/api/files/class/${course.id}`, null, accounts[0].token);
  assert.ok(folder.id);
  const url = `${origin}/client/reading.html`;
  const children = await request('GET', `/api/files/folder/${folder.id}`, null, accounts[0].token);
  const file = children.find(item => item.Source?.filepath === url)
    || await request('POST', `/api/files/file/${folder.id}`, { name: 'Native demo reading', url }, accounts[0].token);
  assert.ok(file.id);
  const classes = await request('GET', `/api/annotations/myClasses?url=${encodeURIComponent(url)}`, null, accounts[1].token);
  assert.ok(classes.some(item => item.id === course.id), 'Second account must have access through native membership');
  fs.writeFileSync(receipt, JSON.stringify({ courseId: course.id, url, apiOrigin: origin, users: accounts.map(({ id }) => id) }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log('Two synthetic demo accounts, native course/membership and reading created. No annotations or replies seeded.');
}

seed().catch(error => { console.error(error.message); process.exit(1); });
