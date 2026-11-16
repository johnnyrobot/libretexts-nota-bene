const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

test('baseline capture produces an email without opening a network connection', async () => {
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = () => { throw new Error('The capture attempted network delivery'); };
  process.env.NODE_ENV = 'dev';
  process.env.NB_EMAIL_MODE = 'capture';
  try {
    const transport = require('../email-config');
    const result = await transport.sendMail({ from: 'fixture@baseline.invalid', to: 'reader@baseline.invalid', subject: 'Local baseline', text: 'Synthetic captured message' });
    assert.ok(Buffer.isBuffer(result.message));
    assert.match(result.message.toString(), /Synthetic captured message/);
    transport.close();
  } finally {
    net.Socket.prototype.connect = original;
  }
});
