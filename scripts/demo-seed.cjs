// Creates the two synthetic demo accounts, course, membership and reading through
// native NB APIs on the loopback listener (public registration is closed at the proxy).
// Run once on the host as the operator. It never creates annotations or replies.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { parseOrigin } = require('./demo-config.cjs');

const operatorDir = process.env.NB_DEMO_OPERATOR_DIR;
if (!operatorDir || !path.isAbsolute(operatorDir)) throw new Error('Set absolute NB_DEMO_OPERATOR_DIR.');
const origin = parseOrigin(process.env.NB_DEMO_ORIGIN);
const port = Number(process.env.NB_DEMO_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Set NB_DEMO_PORT.');
const receipt = path.join(operatorDir, 'fixture.json');
if (fs.existsSync(receipt)) throw new Error('Demo fixture already exists. Restart without reseeding.');
const settings = JSON.parse(fs.readFileSync(path.join(operatorDir, 'settings.json'), 'utf8'));
assert.equal(settings.users?.length, 2, 'settings.json must list exactly two synthetic accounts');
for (const user of settings.users) assert.match(user.email, /@demo\.invalid$/, 'demo accounts use reserved .invalid email');

function request(method, pathname, body, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${method} ${pathname.split('?')[0]}: HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Invalid JSON at ${pathname.split('?')[0]}`)); }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('Local request timeout')));
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function seed() {
  const accounts = [];
  for (const user of settings.users) {
    await request('POST', '/api/users/register', user);
    const { token } = await request('POST', '/api/users/login', { username: user.username, password: user.password });
    const actor = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).user;
    accounts.push({ id: actor.id, token });
  }
  const course = await request('POST', '/api/classes/create', { name: 'Nota Bene native demo' }, accounts[0].token);
  assert.ok(course.id);
  await request('POST', `/api/classes/student/${course.id}`, { id: accounts[1].id }, accounts[0].token);
  const folder = await request('GET', `/api/files/class/${course.id}`, null, accounts[0].token);
  assert.ok(folder.id);
  const url = `${origin}/client/reading.html`;
  const file = await request('POST', `/api/files/file/${folder.id}`, { name: 'Native demo reading', url }, accounts[0].token);
  assert.ok(file.id);
  const classes = await request('GET', `/api/annotations/myClasses?url=${encodeURIComponent(url)}`, null, accounts[1].token);
  assert.ok(classes.some(item => item.id === course.id), 'Second account must have access through native membership');
  fs.writeFileSync(receipt, JSON.stringify({ courseId: course.id, url, apiOrigin: origin, users: accounts.map(({ id }) => id) }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log('Two synthetic demo accounts, native course/membership and reading created. No posts seeded.');
}

seed().catch(error => { console.error(error.message); process.exit(1); });
