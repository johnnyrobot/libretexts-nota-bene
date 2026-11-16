const { test, expect } = require('@playwright/test');
const http = require('node:http');
const { localBrowser } = require('./helpers/local-browser.cjs');

test('network guard rejects redirects before an unapproved endpoint receives a request', async ({ browser }) => {
  let requests = 0;
  const target = http.createServer((_, res) => { requests++; res.end('Unapproved fixture endpoint'); });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  const destination = `http://127.0.0.1:${target.address().port}/unapproved`;
  const source = http.createServer((_, res) => { res.writeHead(302, { Location: destination }); res.end(); });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  const { context, blocked } = await localBrowser(browser, [String(source.address().port)]);
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${source.address().port}/redirect`).catch(() => {});
    expect(blocked.has(destination)).toBe(true);
    expect(requests).toBe(0);
  } finally {
    await context.close();
    await Promise.all([new Promise(resolve => source.close(resolve)), new Promise(resolve => target.close(resolve))]);
  }
});

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
