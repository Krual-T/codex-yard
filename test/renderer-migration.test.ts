import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { transform } from 'esbuild';
import { rendererRoot } from '../lib/app-resources.ts';
import { adaptMigratedRendererModule, rendererComponentsPath } from '../src/native/renderer-migration.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { webRendererPrefix } from '../src/native/visualizations.ts';
import { createFakeCodex } from './fake-codex.ts';

test('the pinned component seams produce valid ESM and require unique function boundaries', async () => {
  for (const [path, marker, end, next] of [
    ['/assets/app-initial-a68277f60b93.js', 'function YEc(e){', '(l=(0,eDc.jsx)(ZEc,{dateString:n,now:c,dayBasis:o}),t[6]=n,t[7]=o,t[8]=c,t[9]=l):l=t[9],l}', 'function XEc(e){'],
    ['/assets/app-initial-a68277f60b93.js', 'function GTc(e){', 't[272]=fee,t[273]=pee,t[274]=Or,t[275]=mee):mee=t[275],mee}', 'function KTc(e){'],
    ['/assets/app-initial-a68277f60b93.js', 'function vEc(e){', 't[13]=i,t[14]=l,t[15]=u,t[16]=d):d=t[16],d}', 'var yEc,bEc;'],
    ['/assets/app-initial-a68277f60b93.js', 'function hzc(e){', 't[8]=n.tooltipContent,t[9]=c,t[10]=l):l=t[10],l}', 'var gzc,_zc,vzc;'],
    ['/assets/app-initial-a68277f60b93.js', 'function Ard(e){let t=(0,Prd.c)(54),', 't[52]=O,t[53]=F):F=t[53],F}', 'function jrd(e){'],
    ['/assets/app-initial-a68277f60b93.js', 'function trd(e){let t=(0,nrd.c)(5),', 'description:`Shimmering status text shown while a Mermaid diagram response is waiting to render`})})}),t[4]=i):i=t[4],i}', 'var nrd,rrd;'],
    ['/assets/collapsible-user-message-content-636c4ff1e0ff.js', 'function C(e){', 'n[57]=Q,n[58]=$):$=n[58],$}', 'function w(e,t,n){'],
    ['/assets/app-primary-f5ea123a0407.js', 'function RBt(e){', 't[17]=T,t[18]=O,t[19]=k):k=t[19],k}', 'async function zBt(e){'],
    ['/assets/app-shared-61271c39e3c5.js', 'function zzn(e){let t=(0,Hzn.c)(79),', 't[77]=K,t[78]=De):De=t[78],De}', 'function Bzn(e){'],
  ]) {
    const original = await readFile(join(rendererRoot, path));
    const adapted = adaptMigratedRendererModule(path, original);
    assert.ok(adapted.includes(Buffer.from(`from"${rendererComponentsPath}"`)));
    await transform(adapted.toString(), { format: 'esm', target: 'es2022' });
    const missing = Buffer.from(original.toString().replace(marker, 'function MissingMigrationBoundary(e){'));
    assert.throws(() => adaptMigratedRendererModule(path, missing), /does not match the pinned renderer/);
    const duplicated = Buffer.concat([original, Buffer.from(marker + '}')]);
    assert.throws(() => adaptMigratedRendererModule(path, duplicated), /does not match the pinned renderer/);
    for (const duplicatedEnd of [Buffer.concat([Buffer.from(end), original]), Buffer.concat([original, Buffer.from(end)])]) {
      assert.throws(() => adaptMigratedRendererModule(path, duplicatedEnd), /does not match the pinned renderer/);
    }
    const adjacentCode = 'function untouchedAdjacentFunction(){return 42}';
    const withAdjacentCode = Buffer.from(original.toString().replace(next, adjacentCode + next));
    assert.ok(adaptMigratedRendererModule(path, withAdjacentCode).includes(Buffer.from(adjacentCode)));
    assert.deepEqual(await readFile(join(rendererRoot, path)), original);
  }
  const unrelated = Buffer.from('export const unchanged = true;');
  assert.equal(adaptMigratedRendererModule('/assets/unrelated.js', unrelated), unrelated);
});

test('adapted modules cannot remain immutable across authored component upgrades', async t => {
  const root = await mkdtemp('/tmp/yard-migration-cache-');
  const fake = await createFakeCodex(root);
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  t.after(async () => { await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    dataDir: join(root, 'data'), workspace: root, hostCatalog: { hosts: [], projects: [], assignments: {} } });
  for (const path of ['app-initial-a68277f60b93.js', 'collapsible-user-message-content-636c4ff1e0ff.js', 'app-primary-f5ea123a0407.js', 'app-shared-61271c39e3c5.js']) {
    // Check both first adaptation and the server's in-memory cached response.
    for (let request = 0; request < 2; request++) {
      const response: Response = await fetch(app.url + webRendererPrefix + '/assets/' + path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok((await response.text()).includes(`from"${rendererComponentsPath}"`));
    }
  }
  const components = await fetch(app.url + rendererComponentsPath);
  assert.equal(components.headers.get('cache-control'), 'no-store');
  await components.arrayBuffer();
  const unchanged = await fetch(app.url + webRendererPrefix + '/assets/rpc-e690e45d1264.js');
  assert.equal(unchanged.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  await unchanged.arrayBuffer();
});
