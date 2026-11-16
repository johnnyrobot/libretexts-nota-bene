// Isolated native NB demo launcher (LT-575). Plain HTTP on loopback only;
// the reverse proxy terminates public HTTPS. Email is captured, never sent.
const http = require('node:http');
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
  const server = http.createServer(createDemoApp({ app, clientDir: config.clientDir }));
  const io = require('../socketapi').io;
  io.attach(server, { cors: { origin: config.origin, credentials: true } });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', resolve);
  });
  console.log(`NB demo ready on http://127.0.0.1:${config.port} for ${config.origin}; email capture only.`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    io.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
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
