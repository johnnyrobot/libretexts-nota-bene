const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {
  parseOrigin, rewriteClientBundle, readDemoEnv, createDemoApp,
} = require('../scripts/demo-config.cjs');

const dev = 'Environments={dev:{baseURL:"https://127.0.0.1:3000",pluginURL:"https://127.0.0.1:3001"}}';
const secret = 'a'.repeat(64);
const validEnv = {
  NB_DEMO_ORIGIN: 'https://nb.libretexts.dev',
  NB_DEMO_PORT: '3475',
  NB_DEMO_CLIENT_DIR: '/opt/nb-demo/current/client',
  DATABASE_URL: 'postgres://nb_demo:0123abcd@127.0.0.1:55475/nb_demo',
  JWT_SECRET: secret,
};

test('public origin must be a bare HTTPS origin', () => {
  assert.equal(parseOrigin('https://nb.libretexts.dev'), 'https://nb.libretexts.dev');
  assert.equal(parseOrigin('https://nb.localhost:8443'), 'https://nb.localhost:8443');
  for (const bad of ['http://nb.libretexts.dev', 'https://nb.libretexts.dev/', 'https://nb.libretexts.dev/x',
    'https://u:p@nb.libretexts.dev', 'https://nb.libretexts.dev?x=1', 'https://127.0.0.1:3000', 'nb.libretexts.dev', '']) {
    assert.throws(() => parseOrigin(bad), /public HTTPS origin/, bad);
  }
});

test('client bundle rewrite replaces exactly the native development pair', () => {
  const out = rewriteClientBundle(dev, 'https://nb.libretexts.dev');
  assert.equal(out, 'Environments={dev:{baseURL:"https://nb.libretexts.dev",pluginURL:"https://nb.libretexts.dev/client"}}');
  assert.doesNotMatch(out, /127\.0\.0\.1/);
});

test('client bundle rewrite refuses an unexpected bundle shape', () => {
  assert.throws(() => rewriteClientBundle(dev.replace('3001', '9999'), 'https://nb.libretexts.dev'), /exactly one/);
  assert.throws(() => rewriteClientBundle(dev + dev, 'https://nb.libretexts.dev'), /exactly one/);
  assert.throws(() => rewriteClientBundle(dev + ';fetch("https://127.0.0.1:3000/x")', 'https://nb.libretexts.dev'), /exactly one/);
  assert.throws(() => rewriteClientBundle(dev, 'http://nb.libretexts.dev'), /public HTTPS origin/);
});

test('demo environment requires loopback database, loopback port and protected secret', () => {
  const config = readDemoEnv(validEnv);
  assert.deepEqual(config, {
    origin: 'https://nb.libretexts.dev', port: 3475, clientDir: '/opt/nb-demo/current/client',
    databaseUrl: validEnv.DATABASE_URL, jwtSecret: secret,
  });
  const cases = {
    DATABASE_URL: ['postgres://nb_demo:pw@db.example.org:5432/nb_demo', 'postgres://nb_demo:p@ss@127.0.0.1:55475/nb_demo',
      'postgres://nb_demo:pw@localhost:55475/nb_demo', 'postgres://nb_demo:pw@127.0.0.1:55475/postgres', 'mysql://x:y@127.0.0.1:1/nb_demo'],
    JWT_SECRET: ['short', 'g'.repeat(64)],
    NB_DEMO_PORT: ['80', '70000', '3475x', ''],
    NB_DEMO_CLIENT_DIR: ['relative/client', ''],
    NB_DEMO_ORIGIN: ['http://nb.libretexts.dev'],
  };
  for (const [key, values] of Object.entries(cases)) {
    for (const value of values) {
      assert.throws(() => readDemoEnv({ ...validEnv, [key]: value }), new RegExp(key), `${key}=${value}`);
    }
  }
});

async function withServer(app, fn) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('demo app serves the rewritten client under /client and leaves other paths to native NB', async () => {
  const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-demo-client-'));
  try {
    fs.mkdirSync(path.join(clientDir, 'js'));
    fs.writeFileSync(path.join(clientDir, 'js', 'bundle.js'), 'bundle');
    fs.writeFileSync(path.join(clientDir, 'reading.html'), '<script src="/client/js/bundle.js"></script>');
    const native = (req, res) => { res.setHeader('x-native', '1'); res.end(`native ${req.url}`); };
    await withServer(createDemoApp({ app: native, clientDir }), async base => {
      const bundle = await fetch(`${base}/client/js/bundle.js`);
      assert.equal(bundle.status, 200);
      assert.equal(await bundle.text(), 'bundle');
      const reading = await fetch(`${base}/client/reading.html`, { headers: { accept: 'text/html' } });
      assert.equal(reading.status, 200);
      assert.match(await reading.text(), /\/client\/js\/bundle\.js/);
      const missing = await fetch(`${base}/client/nope.js`, { headers: { accept: 'text/html' } });
      assert.equal(missing.status, 404);
      assert.equal(missing.headers.get('x-native'), null, 'missing client assets must not fall through to the SPA history fallback');
      const traversal = await fetch(`${base}/client/..%2fjs/bundle.js`);
      assert.equal(traversal.status, 404);
      const api = await fetch(`${base}/api/check`);
      assert.equal(api.headers.get('x-native'), '1');
      assert.equal(await api.text(), 'native /api/check');
      assert.equal(api.headers.get('x-powered-by'), null);
    });
  } finally {
    fs.rmSync(clientDir, { recursive: true, force: true });
  }
});

test('host preflight stays read-only', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'nb-demo', 'preflight-readonly.sh'), 'utf8');
  const code = script.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  assert.doesNotMatch(code, /(^|[\s;&|(])(rm|mv|cp|install|useradd|usermod|tee|chmod|chown|mkdir|ln|touch|initdb|pg_ctl|createdb|dropdb|psql|apt|apt-get|dnf|yum|npm\s+(ci|install)|sudo)\s(?!--version)/m);
  assert.doesNotMatch(code, /systemctl\s+(start|stop|restart|reload|enable|disable|daemon-reload|mask)/);
  assert.doesNotMatch(code, /caddy\s+(run|start|stop|reload|trust|adapt\s+.*--validate)/);
  assert.doesNotMatch(code, /sed\s+-i/);
  for (const redirect of code.matchAll(/(?<![<2&]|NR)>{1,2}\s*([^\s;|&)]+)/g)) {
    assert.equal(redirect[1], '/dev/null', `preflight must not write ${redirect[1]}`);
  }
});

test('host install uses the verified full lockfile install', () => {
  // Native NB requires nodemailer, uuid and csv-parser at runtime but lists them as devDependencies,
  // so --omit=dev cannot start the app (found in LT-575 staging). Install as CI and the baseline do.
  const install = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'nb-demo', 'install-release.sh'), 'utf8');
  assert.match(install, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.doesNotMatch(install, /--omit=dev/);
  const lock = require('../package-lock.json');
  for (const name of ['nodemailer', 'uuid', 'csv-parser']) assert.ok(lock.packages[`node_modules/${name}`], name);
});

test('proxy CSP keeps every source same-origin and allows only the eval the native client needs', () => {
  const caddy = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'nb-demo', 'nb-demo.caddy'), 'utf8');
  const csp = caddy.match(/Content-Security-Policy "([^"]+)"/)[1];
  const directives = Object.fromEntries(csp.split(';').map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
  // The native client mounts Vue with string templates, compiled at runtime with new Function
  // (found in LT-575 staging: the sidebar silently never rendered under script-src 'self').
  assert.deepEqual(directives['script-src'], ["'self'", "'unsafe-eval'"]);
  assert.deepEqual(directives['default-src'], ["'self'"]);
  assert.deepEqual(directives['connect-src'], ["'self'"]);
  assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.doesNotMatch(csp, /https?:|wss?:|\*/, 'no third-party or wildcard sources');
});
