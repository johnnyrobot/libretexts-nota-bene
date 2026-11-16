const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { localBrowser } = require('./helpers/local-browser.cjs');

const state = process.env.NB_BASELINE_STATE;
if (!state || !path.isAbsolute(state)) throw new Error('Set absolute NB_BASELINE_STATE.');
const results = process.env.NB_BASELINE_RESULTS;
const root = path.resolve(__dirname, '..');
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
};
if (!results || !path.isAbsolute(results) || inside(root, results) || inside(state, results) || inside(results, state)) {
  throw new Error('Use a results directory outside the checkout, separate from protected state.');
}
const phase = process.env.NB_BASELINE_PHASE || 'create';
if (!['create', 'readback'].includes(phase)) throw new Error('NB_BASELINE_PHASE must be create or readback.');
fs.mkdirSync(results, { recursive: true });
const settings = JSON.parse(fs.readFileSync(path.join(state, 'settings.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(state, 'fixture.json'), 'utf8'));
const run = process.env.NB_BASELINE_RUN || 'native';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('NB_BASELINE_RUN must contain lowercase letters, digits or hyphens.');
const proofPath = path.join(state, `workflow-${run}.json`);
const expectedQuote = process.env.NB_BASELINE_QUOTE || 'Readers can compare explanations';
const passageSelector = process.env.NB_BASELINE_PASSAGE || '#passage';
const question = `LT573 ${run}: How does this passage support cooperation?`;
const reply = `LT573 ${run}: Comparing explanations makes our assumptions visible.`;

async function login(browser, account) {
  const { context, blocked } = await localBrowser(browser);
  const page = await context.newPage();
  await page.goto(fixture.url);
  await page.getByLabel('Username:', { exact: true }).fill(account.username);
  await page.getByLabel('Password:', { exact: true }).fill(account.password);
  const loaded = page.waitForResponse(res => res.url().includes('/api/annotations/annotation?') && res.status() === 200);
  await page.locator('.login-form button[type=submit]').click();
  await loaded;
  await expect(page.locator('#nb-sidebar')).toBeVisible();
  return { page, context, blocked };
}

async function apiRead(page) {
  return page.evaluate(async ({ courseId, url, apiOrigin }) => {
    const response = await fetch(`${apiOrigin || 'https://127.0.0.1:3000'}/api/annotations/annotation?${new URLSearchParams({ class: courseId, url })}`, {
      credentials: 'include',
      headers: { Accept: 'application/json', Authorization: `Bearer ${localStorage.getItem('nb.user')}` },
    });
    if (!response.ok) throw new Error(`Native read failed: ${response.status}`);
    return response.json();
  }, fixture);
}

test('native client creates an annotation and another user replies, with persistent rendered readback', async ({ browser }) => {
  const readOnly = phase === 'readback';
  if (!readOnly && fs.existsSync(proofPath)) throw new Error('This run already has a receipt. Use readback or a new run name; do not count skipped writes as creation.');
  const proof = fs.existsSync(proofPath) ? JSON.parse(fs.readFileSync(proofPath, 'utf8')) : {};
  const actions = { annotationCreated: false, replyCreated: false };
  const alice = await login(browser, settings.users[0]);
  if (!readOnly && !proof.annotationId) {
    if(process.env.NB_BASELINE_SELECTION==='keyboard') {
      await alice.page.getByLabel('Choose a passage to discuss').focus();
      await alice.page.keyboard.press('Home');
      await alice.page.keyboard.press('Tab');
      await alice.page.keyboard.press('Enter');
      await expect(alice.page.locator('.editor-view .ql-editor')).toBeFocused();
    } else {
    await alice.page.locator(passageSelector).first().scrollIntoViewIfNeeded();
    const positions = await alice.page.locator(passageSelector).first().evaluate((element, length) => {
      const text = element.firstChild;
      const start = document.createRange(); start.setStart(text, 0); start.setEnd(text, 1);
      const end = document.createRange(); end.setStart(text, length - 1); end.setEnd(text, length);
      const a = start.getBoundingClientRect(), b = end.getBoundingClientRect();
      return { x1: a.x + 0.2, y1: a.y + a.height / 2, x2: b.right - 0.2, y2: b.y + b.height / 2 };
    }, expectedQuote.length);
    await alice.page.mouse.move(positions.x1, positions.y1);
    await alice.page.mouse.down();
    await alice.page.mouse.move(positions.x2, positions.y2, { steps: 20 });
    expect(await alice.page.evaluate(() => window.getSelection().toString())).toBe(expectedQuote);
    await alice.page.mouse.up();
    }
    const editor = alice.page.locator('.editor-view');
    await expect(editor).toBeVisible();
    await editor.locator('.ql-editor').fill(question);
    await editor.locator('.selections select').first().selectOption('EVERYONE');
    const saved = alice.page.waitForResponse(res => res.url().endsWith('/api/annotations/annotation') && res.request().method() === 'POST');
    await editor.locator('button.submit').click();
    const response = await saved;
    expect(response.status()).toBe(200);
    const body = await response.json();
    proof.annotationId = body.id;
    actions.annotationCreated = true;
    expect(proof.annotationId).toBeTruthy();
    fs.writeFileSync(proofPath, JSON.stringify(proof), { mode: 0o600 });
  }
  expect(proof.annotationId).toBeTruthy();
  await expect(alice.page.locator('#nb-sidebar')).toContainText(question);
  const bob = await login(browser, settings.users[1]);
  await expect(bob.page.locator('#nb-sidebar')).toContainText(question);
  await bob.page.locator('#nb-sidebar').getByText(question, { exact: true }).first().click();
  if (!readOnly && !proof.replyId) {
    await bob.page.locator('.thread-view .footer > span').filter({ has: bob.page.locator('svg[data-icon="reply"]') }).first().click();
    const editor = bob.page.locator('.editor-view');
    await expect(editor).toBeVisible();
    await editor.locator('.ql-editor').fill(reply);
    const saved = bob.page.waitForResponse(res => res.url().includes('/api/annotations/reply/') && res.request().method() === 'POST');
    await editor.locator('button.submit').click();
    const response = await saved;
    expect(response.status()).toBe(200);
    proof.replyId = (await response.json()).id;
    actions.replyCreated = true;
    expect(proof.replyId).toBeTruthy();
    fs.writeFileSync(proofPath, JSON.stringify(proof), { mode: 0o600 });
  }
  expect(proof.replyId).toBeTruthy();
  if (!readOnly) expect(actions).toEqual({ annotationCreated: true, replyCreated: true });
  await expect(bob.page.locator('#nb-sidebar')).toContainText(reply);
  const data = await apiRead(bob.page);
  const serialized = JSON.stringify(data);
  expect(serialized).toContain(proof.annotationId);
  expect(serialized).toContain(proof.replyId);
  expect(serialized).toContain(question);
  expect(serialized).toContain(reply);
  await bob.page.screenshot({ path: path.join(results, `native-${readOnly ? 'restart' : 'create'}.png`), fullPage: true });
  fs.writeFileSync(path.join(results, 'workflow-result.json'), JSON.stringify({ phase: readOnly ? 'readback' : 'create', annotationId: proof.annotationId, replyId: proof.replyId, actions, rendered: true, blockedExternalAssets: [...new Set([...alice.blocked, ...bob.blocked])] }, null, 2));
  await alice.context.close();
  await bob.context.close();
});
