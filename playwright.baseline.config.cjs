const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './test',
  testMatch: 'native-baseline.spec.cjs',
  timeout: 60000,
  workers: 1,
  retries: 0,
  outputDir: process.env.NB_BASELINE_RESULTS,
  reporter: 'line',
  use: { browserName: 'chromium', ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, actionTimeout: 10000, trace: 'off' },
});
