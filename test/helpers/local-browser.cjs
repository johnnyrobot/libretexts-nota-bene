async function localBrowser(browser) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const blocked = new Set();
  const permitted = value => {
    const url = new URL(value);
    return url.hostname === '127.0.0.1' && ['3000', '3001'].includes(url.port);
  };
  await context.route('**/*', route => {
    if (permitted(route.request().url())) return route.continue();
    const url = new URL(route.request().url());
    blocked.add(url.origin + url.pathname);
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => {
    if (permitted(socket.url())) { socket.connectToServer(); return; }
    const url = new URL(socket.url());
    blocked.add(url.origin + url.pathname);
    socket.close();
  });
  return { context, blocked };
}
module.exports = { localBrowser };
