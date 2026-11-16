const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

for (const kind of ['served', 'symlink', 'long']) {
  test(`initializer rejects unsafe state before creating credentials: ${kind}`, () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-state-boundary-'));
    const server = path.join(temporary, 'server');
    const client = path.join(temporary, 'client');
    const bin = path.join(temporary, 'bin');
    fs.mkdirSync(path.join(server, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(client, 'public'), { recursive: true });
    fs.mkdirSync(bin);
    for (const name of ['baseline-init.cjs', 'baseline-paths.cjs']) {
      const source = path.resolve(__dirname, '../scripts', name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(server, 'scripts', name));
    }
    for (const tool of ['initdb', 'pg_ctl', 'createdb']) {
      fs.writeFileSync(path.join(bin, tool), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    }
    let parent = path.join(client, 'public');
    if (kind === 'symlink') {
      fs.symlinkSync(parent, path.join(temporary, 'alias'));
      parent = path.join(temporary, 'alias');
    }
    const state = kind === 'long' ? path.join(temporary, 'state-' + 'a'.repeat(120)) : path.join(parent, 'state');
    try {
      const result = spawnSync(process.execPath, [path.join(server, 'scripts/baseline-init.cjs')], {
        encoding: 'utf8', env: { ...process.env, NB_BASELINE_STATE: state, NB_BASELINE_CLIENT: client, NB_BASELINE_PG_BIN: bin },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, kind === 'long' ? /too long for the baseline Unix socket/ : /outside both checkouts/);
      assert.equal(fs.existsSync(state), false);
    } finally { fs.rmSync(temporary, { recursive: true }); }
  });
}
