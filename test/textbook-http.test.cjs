const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDemoApp } = require('../scripts/demo-config.cjs');
test('book is public, native API remains authoritative, unknown book paths fail closed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-book-'));
  fs.mkdirSync(path.join(root, 'books/social_psychology'), {recursive:true});
  fs.writeFileSync(path.join(root, 'books/social_psychology/index.html'), '<h1>Social Psychology</h1>');
  const express = require('express'); const native = express();
  native.get('/api/proof', (_,res) => res.status(401).send('native-auth-required'));
  const app = createDemoApp({app:native, clientDir:root, textbookDir:root});
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/books/social_psychology/')).status,200);
    assert.equal((await fetch(base+'/books/missing/')).status,404);
    assert.equal((await fetch(base+'/api/proof')).status,401);
  } finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true});}
});
