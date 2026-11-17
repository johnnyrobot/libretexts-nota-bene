async function localBrowser(browser, explicitPorts) {
  const ports = explicitPorts || ['3000', '3001'];
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const blocked = new Set();
  // NB_BASELINE_ORIGINS (comma-separated https origins) selects a staged public origin instead of the local pair.
  // An explicit port list (network regression cases) always keeps the local guard.
  const origins = !explicitPorts && process.env.NB_BASELINE_ORIGINS ? process.env.NB_BASELINE_ORIGINS.split(',') : null;
  const permitted = value => {
    const url = new URL(value);
    if (origins) return origins.includes(url.origin.replace(/^wss:/, 'https:'));
    return url.hostname === '127.0.0.1' && ports.includes(url.port);
  };
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!permitted(url.href)) {
      blocked.add(url.origin + url.pathname);
      return route.abort('blockedbyclient');
    }
    let response;
    try { response = await route.fetch({ maxRedirects: 0 }); }
    catch (error) {
      if (/Target page, context or browser has been closed|Request context disposed|ERR_ABORTED/.test(error.message)) return;
      throw new Error('Isolated request failed at ' + url.pathname);
    }
    if (response.status() >= 300 && response.status() < 400 && response.headers().location) {
      const destination = new URL(response.headers().location, url);
      blocked.add(destination.origin + destination.pathname);
      await response.dispose();
      return route.abort('blockedbyclient');
    }
    try { return await route.fulfill({ response }); }
    finally { await response.dispose(); }
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
