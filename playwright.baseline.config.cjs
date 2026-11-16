const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const results = process.env.NB_BASELINE_RESULTS;
const state = process.env.NB_BASELINE_STATE;
function canonical(value) {
  const absolute = path.resolve(value);
  if (fs.existsSync(absolute)) return fs.realpathSync(absolute);
  return path.join(canonical(path.dirname(absolute)), path.basename(absolute));
}
function overlaps(a, b) {
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}
if (!results || !state || !path.isAbsolute(results) || !path.isAbsolute(state)
  || overlaps(canonical(__dirname), canonical(results)) || overlaps(canonical(state), canonical(results))
  || (process.env.NB_BASELINE_CLIENT && overlaps(canonical(process.env.NB_BASELINE_CLIENT), canonical(results)))
  // Playwright reloads configuration in workers after it creates result directories.
  || (process.env.TEST_WORKER_INDEX === undefined && fs.existsSync(results) && fs.readdirSync(results).length !== 0)) {
  throw new Error('Use a fresh empty results directory separate from both checkouts and protected state.');
}
module.exports = defineConfig({
  testDir: './test',
  testMatch: 'native-baseline.spec.cjs',
  timeout: 60000,
  workers: 1,
  retries: 0,
  outputDir: results,
  reporter: 'line',
  use: { browserName: 'chromium', ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, actionTimeout: 10000, trace: 'off' },
});
