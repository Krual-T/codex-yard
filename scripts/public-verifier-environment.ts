import { constants } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Page } from 'playwright-core';

export async function openChromePanel(page: Page): Promise<void> {
  const toggle = page.locator('summary[aria-label="Open side panel"]');
  const menu = toggle.locator('..');
  if (await menu.getAttribute('open') === null) await toggle.click();
  await menu.getByRole('menuitem', { name: 'Open Chrome panel', exact: true }).click();
  if (await menu.getAttribute('open') !== null) await toggle.click();
}

export async function openComposerModelOptions(page: Page): Promise<void> {
  const menu = page.locator('details.standalone-composer__model');
  if (await menu.getAttribute('open') === null) await menu.locator(':scope > summary').click();
  const choices = menu.locator('details.standalone-composer__model-choices');
  if (await choices.getAttribute('open') === null) await choices.locator(':scope > summary').click();
  const advanced = menu.locator('details.standalone-composer__model-advanced');
  if (await advanced.getAttribute('open') === null) await advanced.locator(':scope > summary').click();
}

/** Keep every verifier's host and child processes inside its disposable fixture. */
export async function isolatePublicVerifier(root: string, npmCacheSeed?: string): Promise<void> {
  const browserPaths = {
    AGENTS_TEST_CHROMIUM: process.env.AGENTS_TEST_CHROMIUM,
    AGENTS_TEST_CHROME: process.env.AGENTS_TEST_CHROME,
  };
  const environment = {
    PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    LANG: 'C.UTF-8',
    HOME: join(root, 'home'),
    CODEX_HOME: join(root, 'codex'),
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_CACHE_HOME: join(root, 'cache'),
    XDG_DATA_HOME: join(root, 'xdg-data'),
    XDG_RUNTIME_DIR: join(root, 'runtime'),
    TMPDIR: join(root, 'tmp'),
    npm_config_cache: join(root, 'npm-cache'),
    npm_config_userconfig: join(root, 'user.npmrc'),
    npm_config_globalconfig: join(root, 'global.npmrc'),
    npm_config_update_notifier: 'false',
  };
  await Promise.all(Object.entries(environment)
    .filter(([name]) => ['HOME', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
      'XDG_RUNTIME_DIR', 'TMPDIR', 'npm_config_cache'].includes(name))
    .map(([, path]) => mkdir(path, { recursive: true, mode: 0o700 })));
  if (npmCacheSeed) {
    await cp(join(resolve(npmCacheSeed), '_cacache'), join(environment.npm_config_cache, '_cacache'),
      { recursive: true, mode: constants.COPYFILE_FICLONE });
  }
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, environment);
  for (const [key, value] of Object.entries(browserPaths)) if (value !== undefined) process.env[key] = value;
}
