const { test, expect } = require('@playwright/test');
const http = require('node:http');
const { localBrowser } = require('./helpers/local-browser.cjs');

test('network guard prevents WebSocket connections outside the selected local pair', async ({ browser }) => {
  let upgrades = 0;
  const server = http.createServer((_, res) => { res.writeHead(404); res.end(); });
  server.on('upgrade', (_, socket) => { upgrades++; socket.destroy(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}/unapproved`;
  const { context, blocked } = await localBrowser(browser);
  try {
    const page = await context.newPage();
    await page.evaluate(value => new Promise(resolve => {
      const socket = new WebSocket(value);
      socket.onclose = () => resolve();
      socket.onerror = () => resolve();
    }), url);
    expect(blocked.has(url)).toBe(true);
    expect(upgrades).toBe(0);
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
});
