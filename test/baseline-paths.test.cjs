const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function loadConfig(state, results) {
  return spawnSync(process.execPath, ['-e', "require('./playwright.baseline.config.cjs')"], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NB_BASELINE_STATE: state, NB_BASELINE_RESULTS: results },
  });
}

test('baseline runner rejects a results ancestor before Playwright can clear the checkout', () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-state-'));
  try {
    const result = loadConfig(state, path.dirname(root));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fresh empty results directory/);
    assert.ok(fs.existsSync(path.join(root, 'package.json')));
  } finally { fs.rmSync(state, { recursive: true }); }
});

test('baseline runner preserves pre-existing files in an arbitrary results directory', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-output-'));
  const state = path.join(temporary, 'state');
  const results = path.join(temporary, 'results');
  fs.mkdirSync(state); fs.mkdirSync(results);
  fs.writeFileSync(path.join(results, 'preserve.txt'), 'Keep this existing work.');
  try {
    const result = loadConfig(state, results);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fresh empty results directory/);
    assert.equal(fs.readFileSync(path.join(results, 'preserve.txt'), 'utf8'), 'Keep this existing work.');
  } finally { fs.rmSync(temporary, { recursive: true }); }
});
