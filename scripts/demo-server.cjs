// Isolated native NB demo launcher (LT-575). Plain HTTP on loopback only;
// the reverse proxy terminates public HTTPS. Email is captured, never sent.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { readDemoEnv, createDemoApp } = require('./demo-config.cjs');

async function main() {
  const config = readDemoEnv(process.env);
  process.env.DATABASE_URL = config.databaseUrl;
  process.env.JWT_SECRET = config.jwtSecret;
  process.env.NODE_ENV = 'production';
  process.env.NB_EMAIL_MODE = 'capture';
  const app = require('../app');
  const db = require('../models');
  await db.ready;
  const server = http.createServer(createDemoApp({ app, clientDir: config.clientDir, textbookDir: process.env.NB_DEMO_TEXTBOOK_DIR || (fs.existsSync(path.join(__dirname, '../textbook/textbook-manifest.json')) ? path.join(__dirname, '../textbook') : undefined) }));
  // socket.io is deliberately not attached: native 'joined' is unauthenticated and new_thread /
  // new_reply carry thread content to the whole room regardless of visibility. Routes still emit
  // into the unattached server, which delivers nothing. Readers see others' posts on reload.
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', resolve);
  });
  console.log(`NB demo ready on http://127.0.0.1:${config.port} for ${config.origin}; email capture only.`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    // Stop accepting, let in-flight requests finish, force-close only after a bounded wait
    // (systemd's stop timeout is longer).
    const force = setTimeout(() => server.closeAllConnections(), 10000);
    await new Promise(resolve => server.close(resolve));
    clearTimeout(force);
    await db.sequelize.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

main().catch(error => {
  // Never print DATABASE_URL or secrets; configuration errors name only the key.
  const known = /^(NB_DEMO_ORIGIN|NB_DEMO_PORT|NB_DEMO_CLIENT_DIR|DATABASE_URL|JWT_SECRET) /.test(error.message);
  console.error(known ? error.message : 'NB demo startup failed. Check the protected environment and database readiness.');
  process.exit(1);
});
