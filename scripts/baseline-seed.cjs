const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const assert = require('node:assert/strict');

const state = process.env.NB_BASELINE_STATE;
if (!state || !path.isAbsolute(state)) throw new Error('Set absolute NB_BASELINE_STATE.');
const receipt = path.join(state, 'fixture.json');
if (fs.existsSync(receipt)) throw new Error('Fixture already exists. Restart without reseeding.');
const settings = JSON.parse(fs.readFileSync(path.join(state, 'settings.json'), 'utf8'));

function request(method, pathname, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = https.request({
      hostname: '127.0.0.1', port: 3000, path: pathname, method,
      rejectUnauthorized: false,
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${method} ${pathname}: HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Invalid JSON at ${pathname}`)); }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('Local request timeout')));
    req.on('error', reject);
    req.end(payload);
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
  const course = await request('POST', '/api/classes/create', { name: 'LT573 native baseline' }, accounts[0].token);
  assert.ok(course.id);
  await request('POST', `/api/classes/student/${course.id}`, { id: accounts[1].id }, accounts[0].token);
  const folder = await request('GET', `/api/files/class/${course.id}`, null, accounts[0].token);
  assert.ok(folder.id);
  const url = 'https://127.0.0.1:3001/fixture.html';
  const file = await request('POST', `/api/files/file/${folder.id}`, { name: 'Native reading', url }, accounts[0].token);
  assert.ok(file.id);
  const classes = await request('GET', `/api/annotations/myClasses?url=${encodeURIComponent(url)}`, null, accounts[1].token);
  assert.ok(classes.some(item => item.id === course.id), 'Bob must have access through native membership');
  fs.writeFileSync(receipt, JSON.stringify({ courseId: course.id, url, users: accounts.map(({ id }) => id) }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log('Two synthetic accounts, native course/membership and reading created through NB APIs. No posts seeded.');
}

seed().catch(error => { console.error(error.message); process.exit(1); });
