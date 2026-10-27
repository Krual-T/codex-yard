// Read-only daemon smoke; hold /tmp/agents-workbench-heavy.lock for the whole run.
// Only the private Web host's Mini visibility changes. No Agent turn is sent.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';

const socketPath = process.env.AGENTS_MINI_SOCKET;
const snapshot = process.env.AGENTS_MINI_SNAPSHOT;
assert.ok(socketPath && snapshot, 'Set AGENTS_MINI_SOCKET and AGENTS_MINI_SNAPSHOT explicitly');
const output = resolve(process.env.AGENTS_PET_EVIDENCE || '.local/mini-evidence');
const root = await mkdtemp('/tmp/aw-mini-menu-');
let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const errors: string[] = [], checks: string[] = [];
let failure: string | undefined;
try {
  await mkdir(output, { recursive: true });
  await cp(snapshot, join(root, 'data/configuration-snapshot'), { recursive: true });
  app = await createNativeWorkbench({ port: 0, dataDir: join(root, 'data'), codexHome: join(root, 'home'), workspace: root,
    hostCatalog: { hosts: [], projects: [], assignments: {} }, socketPath });
  browser = await chromium.launch({ executablePath: process.env.AGENTS_TEST_CHROMIUM, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url);
  const profile = page.getByRole('button', { name: /^(打开个人资料菜单|Open profile menu)$/i });
  await profile.click({ timeout: 60000 });
  await page.getByRole('menuitem', { name: /^(显示虚拟宠物|显示 Mini|Show (pet|mini))(\s|$)/i }).click();
  const iframe = page.locator('[data-workbench-mini] iframe');
  await iframe.waitFor();
  await page.frameLocator('[data-workbench-mini] iframe').locator('[data-codex-pet-id]').first().waitFor({ timeout: 60000 });
  checks.push('official profile menu opens the complete Mini page against the shared daemon');
  await profile.click();
  const hide = page.getByRole('menuitem', { name: /^(隐藏虚拟宠物|隐藏 Mini|Hide (pet|mini))(\s|$)/i });
  await hide.waitFor();
  await writeFile(join(output, 'profile-menu-tree.txt'), await page.getByRole('menu').ariaSnapshot());
  await page.screenshot({ path: join(output, 'profile-menu-close.png') });
  await hide.click();
  await iframe.waitFor({ state: 'detached' });
  const deadline = Date.now() + 10000;
  while ((await (await fetch(app.url + '/api/status')).json()).clients !== 1) {
    assert.ok(Date.now() < deadline, 'Mini left a host connection');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await page.reload();
  await profile.waitFor({ timeout: 60000 });
  assert.equal(await iframe.count(), 0);
  assert.equal(JSON.parse(await readFile(join(root, 'data/native-state.json'), 'utf8')).globals['electron-avatar-overlay-open'], false);
  await page.screenshot({ path: join(output, 'profile-menu-closed.png') });
  checks.push('official profile menu hides Mini, releases its connection and persists closed state after refresh');
  assert.deepEqual(errors, []);
  for (const check of checks) console.log('PASS', check);
} catch (error) {
  failure = String(error);
  throw error;
} finally {
  await writeFile(join(output, 'profile-menu-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), checks, errors, failure }, null, 2));
  try { await browser?.close(); } finally {
    try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); }
  }
}
