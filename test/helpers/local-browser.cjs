async function localBrowser(browser, ports = ['3000', '3001']) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const blocked = new Set();
  const permitted = value => {
    const url = new URL(value);
    return url.hostname === '127.0.0.1' && ports.includes(url.port);
  };
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!permitted(url.href)) {
      blocked.add(url.origin + url.pathname);
      return route.abort('blockedbyclient');
    }
    const response = await route.fetch({ maxRedirects: 0 });
    if (response.status() >= 300 && response.status() < 400 && response.headers().location) {
      const destination = new URL(response.headers().location, url);
      blocked.add(destination.origin + destination.pathname);
      return route.abort('blockedbyclient');
    }
    return route.fulfill({ response });
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
