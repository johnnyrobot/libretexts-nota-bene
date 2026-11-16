const fs = require('node:fs');
const path = require('node:path');
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
    // Large immutable speech files stream in the browser rather than buffering model weights
    // twice in the test runner. HEAD still rejects redirects before the real fetch proceeds.
    const ttsRoot = process.env.NB_BOOK_LISTEN === '1' && process.env.NB_BOOK_TTS_ROOT;
    if (ttsRoot && url.pathname.startsWith('/_assets/tts/') && route.request().method() === 'GET') {
      const root = fs.realpathSync(ttsRoot);
      const file = path.resolve(root, decodeURIComponent(url.pathname.slice('/_assets/tts/'.length)));
      if (!file.startsWith(root + path.sep)) return route.abort('blockedbyclient');
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      if (!fs.realpathSync(file).startsWith(root + path.sep)) return route.abort('blockedbyclient');
      const head = await context.request.head(url.href, { maxRedirects: 0 });
      if (head.status() !== 200 || head.headers().location) return route.abort('blockedbyclient');
      return route.continue();
      }
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
