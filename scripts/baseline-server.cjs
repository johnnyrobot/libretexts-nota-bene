const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { assertStateOutsideCheckouts } = require('./baseline-paths.cjs');

async function main() {
  const state = process.env.NB_BASELINE_STATE;
  const client = process.env.NB_BASELINE_CLIENT;
  if (!state || !path.isAbsolute(state) || !client || !path.isAbsolute(client)) {
    throw new Error('Set absolute NB_BASELINE_STATE and NB_BASELINE_CLIENT paths.');
  }
  assertStateOutsideCheckouts(state, client);
  const settings = JSON.parse(fs.readFileSync(path.join(state, 'settings.json'), 'utf8'));
  const database = new URL(settings.databaseUrl);
  if (database.hostname !== '127.0.0.1' || database.pathname !== '/nb_lt573') {
    throw new Error('The baseline requires its isolated loopback nb_lt573 database.');
  }
  process.env.DATABASE_URL = settings.databaseUrl;
  process.env.JWT_SECRET = settings.jwtSecret;
  process.env.NODE_ENV = 'dev';
  process.env.NB_EMAIL_MODE = 'capture';
  const tls = {
    key: fs.readFileSync(path.join(state, 'key.pem')),
    cert: fs.readFileSync(path.join(state, 'cert.pem')),
  };
  const app = require('../app');
  const db = require('../models');
  await db.ready;
  const api = https.createServer(tls, app);
  require('../socketapi').io.attach(api, { cors: { origin: 'https://127.0.0.1:3001', credentials: true } });
  const express = require('express');
  const plugin = express();
  plugin.get('/fixture.html', (_, res) => res.sendFile(path.resolve(__dirname, '../test/fixtures/native-reading.html')));
  plugin.use(express.static(path.join(client, 'public')));
  const assets = https.createServer(tls, plugin);
  for (const [server, port] of [[api, 3000], [assets, 3001]]) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  }
  console.log('NB baseline ready on loopback HTTPS ports 3000 and 3001; email capture only.');
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    require('../socketapi').io.close();
    api.closeAllConnections();
    assets.closeAllConnections();
    await Promise.all([new Promise(resolve => api.close(resolve)), new Promise(resolve => assets.close(resolve))]);
    await db.sequelize.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

main().catch(error => {
  console.error(error.code === 'NB_BASELINE_STATE_PATH' ? error.message : 'NB baseline startup failed. Check protected local state and database readiness.');
  process.exit(1);
});
