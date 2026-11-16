const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

process.umask(0o077);
const state = process.env.NB_BASELINE_STATE;
const pgBin = process.env.NB_BASELINE_PG_BIN;
const root = path.resolve(__dirname, '..');
if (!state || !path.isAbsolute(state) || !pgBin || !path.isAbsolute(pgBin)) {
  throw new Error('Set absolute NB_BASELINE_STATE and NB_BASELINE_PG_BIN paths.');
}
const relative = path.relative(root, path.resolve(state));
if (!relative.startsWith('..' + path.sep) || fs.existsSync(state) || fs.existsSync(path.join(root, 'config.js'))) {
  throw new Error('Use a new state directory outside the checkout and preserve any existing config.js.');
}
for (const tool of ['initdb', 'pg_ctl', 'createdb']) fs.accessSync(path.join(pgBin, tool), fs.constants.X_OK);
fs.mkdirSync(state, { recursive: true, mode: 0o700 });
fs.chmodSync(state, 0o700);
const password = crypto.randomBytes(24).toString('hex');
const settings = {
  databaseUrl: `postgres://nb_baseline:${password}@127.0.0.1:55473/nb_lt573`,
  jwtSecret: crypto.randomBytes(32).toString('hex'),
  users: ['alice', 'bob'].map(name => ({
    username: `baseline_${name}`, first: name === 'alice' ? 'Alice' : 'Bob',
    last: 'Baseline', email: `${name}@baseline.invalid`, password: crypto.randomBytes(16).toString('hex'),
  })),
};
fs.writeFileSync(path.join(state, 'settings.json'), JSON.stringify(settings), { flag: 'wx', mode: 0o600 });
fs.writeFileSync(path.join(state, 'postgres-password'), password, { flag: 'wx', mode: 0o600 });
fs.mkdirSync(path.join(state, 'sockets'), { mode: 0o700 });
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', path.join(state, 'key.pem'), '-out', path.join(state, 'cert.pem'), '-days', '30',
  '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' });
execFileSync(path.join(pgBin, 'initdb'), ['-D', path.join(state, 'pgdata'), '-U', 'nb_baseline',
  '--auth-local=trust', '--auth-host=scram-sha-256', '--pwfile=' + path.join(state, 'postgres-password'),
  '--encoding=UTF8', '--locale=C'], { stdio: 'ignore' });
execFileSync(path.join(pgBin, 'pg_ctl'), ['-D', path.join(state, 'pgdata'), '-l', path.join(state, 'postgres.log'),
  '-o', `-h 127.0.0.1 -p 55473 -k ${path.join(state, 'sockets')}`, '-w', 'start'], { stdio: 'inherit' });
execFileSync(path.join(pgBin, 'createdb'), ['-h', '127.0.0.1', '-p', '55473', '-U', 'nb_baseline', 'nb_lt573'], {
  env: { ...process.env, PGPASSWORD: password }, stdio: 'inherit',
});
fs.writeFileSync(path.join(root, 'config.js'), 'module.exports = { db: {} };\n', { flag: 'wx', mode: 0o600 });
console.log('New isolated database and protected local settings created. No application records seeded.');
