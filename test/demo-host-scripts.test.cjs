// Runs the Chief-gated host scripts against stubbed systemctl/runuser in a temp tree, so their
// failure paths are exercised without root or a Linux host (LT-575, PR-Agent findings).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const source = path.join(__dirname, '..', 'deploy', 'nb-demo');

function sandbox({ failRestart = false, failRestore = false, previous = true }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nb-demo-host-')));
  const dir = path.join(root, 'scripts');
  const bin = path.join(root, 'bin');
  const opt = path.join(root, 'opt');
  const backups = path.join(root, 'backups');
  const calls = path.join(root, 'calls.log');
  for (const d of [dir, bin, path.join(opt, 'releases'), backups]) fs.mkdirSync(d, { recursive: true });
  for (const name of ['activate-release.sh', 'restore-backup.sh']) fs.copyFileSync(path.join(source, name), path.join(dir, name));
  fs.writeFileSync(path.join(dir, 'common.sh'), [
    `NB_DEMO_ROOT=${opt}`, `NB_DEMO_BACKUPS=${backups}`, `NB_DEMO_DATA=${root}/data`, 'NB_DEMO_DB_USER=nbdemo-pg', 'NB_DEMO_PG_PORT=55475',
    'require_root() { :; }', `pg_bin() { printf '%s' ${root}/pg; }`, ''].join('\n'));
  const script = (file, body) => fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  script(path.join(dir, 'backup.sh'), `echo ${backups}/safety`);
  // Health passes only when the service is running the old release.
  script(path.join(dir, 'health.sh'), `[ "$(readlink ${opt}/current)" = "${opt}/releases/old" ]`);
  script(path.join(bin, 'systemctl'), `echo "systemctl $*" >> ${calls}\n${failRestart ? `if [ "$1" = restart ] && [ "$(readlink ${opt}/current)" = "${opt}/releases/new" ]; then exit 1; fi` : ''}\nexit 0`);
  script(path.join(bin, 'runuser'), `echo "runuser $*" >> ${calls}\ncat > /dev/null\nexit ${failRestore ? 1 : 0}`);
  script(path.join(bin, 'sha256sum'), 'exit 0');
  // GNU mv -T is not on macOS; -h is its equivalent, keeping the rename semantics the scripts rely on.
  script(path.join(bin, 'mv'), 'args=(); for a in "$@"; do [ "$a" = -T ] || args+=("$a"); done; exec /bin/mv -fh "${args[@]}"');
  for (const id of ['old', 'new']) {
    fs.mkdirSync(path.join(opt, 'releases', id));
    fs.writeFileSync(path.join(opt, 'releases', id, 'RELEASE.json'), '{}');
  }
  if (previous) fs.symlinkSync(path.join(opt, 'releases', 'old'), path.join(opt, 'current'));
  fs.mkdirSync(path.join(backups, 'b1'));
  fs.writeFileSync(path.join(backups, 'b1', 'nb_demo.dump'), 'dump');
  const run = (...args) => spawnSync('bash', [path.join(dir, args[0]), ...args.slice(1)], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  const log = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '');
  return { root, opt, backups, run, log, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('activation restores the previous release when the service fails to restart', () => {
  const s = sandbox({ failRestart: true });
  try {
    const result = s.run('activate-release.sh', 'new');
    assert.equal(result.status, 1, result.stderr);
    assert.equal(fs.readlinkSync(path.join(s.opt, 'current')), path.join(s.opt, 'releases', 'old'));
    assert.equal(fs.existsSync(path.join(s.opt, 'previous')), false, 'a failed release must not move the rollback target');
  } finally { s.cleanup(); }
});

test('a failed first activation leaves nothing pointing at the failed release', () => {
  const s = sandbox({ failRestart: true, previous: false });
  try {
    const result = s.run('activate-release.sh', 'new');
    assert.equal(result.status, 1, result.stderr);
    assert.equal(fs.existsSync(path.join(s.opt, 'current')), false);
    assert.match(s.log(), /systemctl disable --now nb-demo.service/);
  } finally { s.cleanup(); }
});

test('a failed database restore restarts the app and keeps the failure status', () => {
  const s = sandbox({ failRestore: true });
  try {
    const result = s.run('restore-backup.sh', path.join(s.backups, 'b1'), '--confirm-nb-demo-restore');
    assert.notEqual(result.status, 0);
    const log = s.log();
    assert.match(log, /systemctl stop nb-demo.service[\s\S]*runuser[\s\S]*systemctl start nb-demo.service/);
  } finally { s.cleanup(); }
});
