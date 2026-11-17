// Runs the Chief-gated host scripts against stubbed systemctl/runuser in a temp tree, so their
// failure paths are exercised without root or a Linux host (LT-575, PR-Agent findings).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const source = path.join(__dirname, '..', 'deploy', 'nb-demo');

function sandbox({ failRestart = false, failRestore = false, failLink = false, previous = true }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nb-demo-host-')));
  const dir = path.join(root, 'scripts');
  const bin = path.join(root, 'bin');
  const opt = path.join(root, 'opt');
  const backups = path.join(root, 'backups');
  const calls = path.join(root, 'calls.log');
  for (const d of [dir, bin, path.join(opt, 'releases'), backups]) fs.mkdirSync(d, { recursive: true });
  for (const name of ['activate-release.sh', 'restore-backup.sh', 'rollback.sh']) fs.copyFileSync(path.join(source, name), path.join(dir, name));
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
  // BSD mv on macOS has no -T; -h is its equivalent. Linux (CI, the host) runs GNU mv unchanged.
  if (process.platform === 'darwin') {
    script(path.join(bin, 'mv'), 'args=(); for a in "$@"; do [ "$a" = -T ] || args+=("$a"); done; exec /bin/mv -fh "${args[@]}"');
  }
  if (failLink) script(path.join(bin, 'ln'), 'exit 1');
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
    assert.match(s.log(), /systemctl restart nb-demo.service\nsystemctl restart nb-demo.service/, 'the failed restart and the rollback restart both ran');
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
    assert.equal(result.status, 1, 'keeps the pg_restore exit status');
    const log = s.log();
    assert.match(log, /systemctl stop nb-demo.service[\s\S]*runuser[\s\S]*systemctl start nb-demo.service/);
  } finally { s.cleanup(); }
});

test('rollback stops when the new link cannot be written', () => {
  const s = sandbox({ failLink: true, previous: false });
  try {
    fs.symlinkSync(path.join(s.opt, 'releases', 'new'), path.join(s.opt, 'current'));
    fs.writeFileSync(path.join(s.opt, 'previous'), `${path.join(s.opt, 'releases', 'old')}\n`);
    const result = s.run('rollback.sh');
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(path.join(s.opt, 'previous'), 'utf8'), `${path.join(s.opt, 'releases', 'old')}\n`, 'keeps the real rollback target');
    assert.doesNotMatch(s.log(), /restart/);
  } finally { s.cleanup(); }
});

test('book binding failure happens before backup, service changes or switching', () => {
 const s=sandbox({});
 try {
  const target=path.join(s.opt,'releases/new'), operator=path.join(s.root,'operator');
  fs.mkdirSync(operator);fs.mkdirSync(path.join(target,'textbook'));fs.mkdirSync(path.join(target,'scripts'));
  fs.copyFileSync(path.join(__dirname,'../scripts/textbook-binding.cjs'),path.join(target,'scripts/textbook-binding.cjs'));
  fs.writeFileSync(path.join(target,'RELEASE.json'),JSON.stringify({origin:'https://nb.example'}));
  fs.writeFileSync(path.join(target,'textbook/textbook-manifest.json'),'changed content');
  fs.writeFileSync(path.join(operator,'textbook-registration.json'),JSON.stringify({digest:'prior',origin:'https://nb.example'}));
  fs.appendFileSync(path.join(s.root,'scripts/common.sh'),`\nNB_DEMO_OPERATOR=${operator}\n`);
  const r=s.run('activate-release.sh','new');assert.equal(r.status,1);assert.equal(s.log(),'');assert.equal(fs.readlinkSync(path.join(s.opt,'current')),path.join(s.opt,'releases/old'));
 }finally{s.cleanup();}
});

test('successful activation records the real previous release',()=>{
 const s=sandbox({});try{
  fs.writeFileSync(path.join(s.root,'scripts/health.sh'),'#!/usr/bin/env bash\nexit 0\n',{mode:0o755});
  const r=s.run('activate-release.sh','new');assert.equal(r.status,0,r.stderr);assert.equal(fs.readlinkSync(path.join(s.opt,'current')),path.join(s.opt,'releases/new'));assert.equal(fs.readFileSync(path.join(s.opt,'previous'),'utf8').trim(),path.join(s.opt,'releases/old'));
 }finally{s.cleanup();}
});
