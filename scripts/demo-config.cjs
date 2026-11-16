// Configuration and composition for the isolated native NB demo (LT-575).
// The demo serves native NB unchanged behind a TLS-terminating reverse proxy.
const path = require('node:path');

const DEV_API = 'https://127.0.0.1:3000';
const DEV_PLUGIN = 'https://127.0.0.1:3001';

function parseOrigin(value) {
  let url;
  try { url = new URL(value); } catch { url = null; }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.origin !== value || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) {
    throw new Error('NB_DEMO_ORIGIN must be a public HTTPS origin such as https://nb.libretexts.dev with no path.');
  }
  return url.origin;
}

function countOf(source, needle) {
  return source.split(needle).length - 1;
}

// The merged client selects Environments.dev at build time. Rewrite that one
// pair to the public origin, following upstream's prod layout (plugin at /client).
function rewriteClientBundle(source, origin) {
  const target = parseOrigin(origin);
  if (countOf(source, `"${DEV_API}"`) !== 1 || countOf(source, `"${DEV_PLUGIN}"`) !== 1
    || countOf(source, '127.0.0.1') !== 2) {
    throw new Error('Client bundle must contain exactly one native development API and plugin origin.');
  }
  return source.replace(`"${DEV_API}"`, JSON.stringify(target)).replace(`"${DEV_PLUGIN}"`, JSON.stringify(`${target}/client`));
}

function fail(key, message) {
  throw new Error(`${key} ${message}`);
}

function readDemoEnv(env) {
  let origin;
  try { origin = parseOrigin(env.NB_DEMO_ORIGIN); } catch (error) { fail('NB_DEMO_ORIGIN', error.message); }
  const portText = env.NB_DEMO_PORT || '';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1024 || port > 65535) fail('NB_DEMO_PORT', 'must be an unprivileged TCP port.');
  const clientDir = env.NB_DEMO_CLIENT_DIR || '';
  if (!path.isAbsolute(clientDir)) fail('NB_DEMO_CLIENT_DIR', 'must be an absolute path.');
  // models/index.js parses this exact shape; keep the password to characters it accepts.
  const databaseUrl = env.DATABASE_URL || '';
  if (!/^postgres:\/\/[a-z_][a-z0-9_]*:[A-Za-z0-9]+@127\.0\.0\.1:\d+\/nb_demo$/.test(databaseUrl)) {
    fail('DATABASE_URL', 'must use the isolated nb_demo database on 127.0.0.1 with an alphanumeric password.');
  }
  const jwtSecret = env.JWT_SECRET || '';
  if (!/^[0-9a-f]{64,}$/.test(jwtSecret)) fail('JWT_SECRET', 'must be at least 64 generated hexadecimal characters.');
  return { origin, port, clientDir, databaseUrl, jwtSecret };
}

function createDemoApp({ app, clientDir }) {
  const express = require('express');
  const outer = express();
  outer.disable('x-powered-by');
  const client = express.Router();
  client.use(express.static(clientDir, { index: false, dotfiles: 'deny', fallthrough: true }));
  // Missing client assets end here instead of reaching NB's SPA history fallback.
  client.use((_, res) => res.status(404).type('text/plain').send('Not found'));
  outer.use('/client', client);
  outer.use(app);
  return outer;
}

module.exports = { parseOrigin, rewriteClientBundle, readDemoEnv, createDemoApp };
