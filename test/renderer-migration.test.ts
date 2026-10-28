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

test('unverified historical component boundaries remain identifiable', async () => {
  // This historical oracle does not establish behavior in the owned App.
  const validatedModules = new Set<string>();
  for (const [path, marker, end, next] of [
    ['/assets/app-initial-a68277f60b93.js', 'function YEc(e){', '(l=(0,eDc.jsx)(ZEc,{dateString:n,now:c,dayBasis:o}),t[6]=n,t[7]=o,t[8]=c,t[9]=l):l=t[9],l}', 'function XEc(e){'],
    ['/assets/app-initial-a68277f60b93.js', 'function GTc(e){', 't[272]=fee,t[273]=pee,t[274]=Or,t[275]=mee):mee=t[275],mee}', 'function KTc(e){'],
    ['/assets/app-initial-a68277f60b93.js', 'function vEc(e){', 't[13]=i,t[14]=l,t[15]=u,t[16]=d):d=t[16],d}', 'var yEc,bEc;'],
    ['/assets/app-initial-a68277f60b93.js', 'function hzc(e){', 't[8]=n.tooltipContent,t[9]=c,t[10]=l):l=t[10],l}', 'var gzc,_zc,vzc;'],
    ['/assets/app-initial-a68277f60b93.js', 'function Ard(e){let t=(0,Prd.c)(54),', 't[52]=O,t[53]=F):F=t[53],F}', 'function jrd(e){'],
    ['/assets/app-initial-a68277f60b93.js', 'function trd(e){let t=(0,nrd.c)(5),', 'description:`Shimmering status text shown while a Mermaid diagram response is waiting to render`})})}),t[4]=i):i=t[4],i}', 'var nrd,rrd;'],
    ['/assets/app-initial-a68277f60b93.js', 'function Jdd(e){let t=(0,Xdd.c)(29),', 't[22]=o,t[23]=n,t[24]=_,t[25]=v,t[26]=y,t[27]=g,t[28]=b):b=t[28],b}', 'function Ydd(e){'],
    ['/assets/app-initial-a68277f60b93.js', 'function Nod(e){let t=(0,Pod.c)(55),', 't[52]=ie,t[53]=be,t[54]=xe):xe=t[54],xe}', 'var Pod,Fod,Iod;function Lod()'],
    ['/assets/app-shared-61271c39e3c5.js', 'function zzn(e){let t=(0,Hzn.c)(79),', 't[77]=K,t[78]=De):De=t[78],De}', 'function Bzn(e){'],
    ['/assets/settings-page-25f8fd08b293.js', 'function _i(){let e=(0,Ci.c)(143),', 'e[139]=Je,e[140]=nt,e[141]=it,e[142]=at):at=e[142],at}', 'function vi(e){'],
    ['/assets/general-settings-8997e171b11a.js', 'function Js(){', 'e[5]=n,e[6]=a),a}', 'function Ys(){'],
    ['/assets/general-settings-8997e171b11a.js', 'function tc(e){', 'n[28]=C,n[29]=m,n[30]=w):w=n[30],w}', 'function nc(){'],
    ['/assets/general-settings-8997e171b11a.js', 'function Qa(e){', 't[3]=n,t[4]=s,t[5]=l,t[6]=u):u=t[6],u}', 'function $a(e){'],
    ['/assets/general-settings-8997e171b11a.js', 'function $a(e){', 'theme:E,value:E.contrast,onChange:e=>{T({contrast:e})}}),label:p})]})}', 'function eo(e){'],
    ['/assets/general-settings-8997e171b11a.js', 'function yc(){', 'e[8]=o,e[9]=s,e[10]=c):c=e[10],c}', 'function bc(){'],
    ['/assets/general-settings-8997e171b11a.js', 'function jc(){', 'description:`Unit label for sans font size setting`}),e[18]=n,e[19]=h);let g;e[20]===h?g=e[21]:(g=(0,$.jsx)(`span`,{className:`text-sm text-secondary`,children:h}),e[20]=h,e[21]=g);let _;return e[22]!==g||e[23]!==m?(_=(0,$.jsx)(V,{label:s,description:c,control:(0,$.jsxs)(`div`,{className:`flex items-center gap-2`,children:[m,g]})}),e[22]=g,e[23]=m,e[24]=_):_=e[24],_}', 'function Mc(){'],
    ['/assets/general-settings-8997e171b11a.js', 'function Mc(){', 'description:`Unit label for code font size setting`}),e[18]=n,e[19]=h);let g;e[20]===h?g=e[21]:(g=(0,$.jsx)(`span`,{className:`text-sm text-secondary`,children:h}),e[20]=h,e[21]=g);let _;return e[22]!==g||e[23]!==m?(_=(0,$.jsx)(V,{label:s,description:c,control:(0,$.jsxs)(`div`,{className:`flex items-center gap-2`,children:[m,g]})}),e[22]=g,e[23]=m,e[24]=_):_=e[24],_}', 'function Nc(){'],
    ['/assets/general-settings-8997e171b11a.js', 'function Ec(){', 'e[23]=a,e[24]=r,e[25]=_,e[26]=v):v=e[26],v}', 'function Dc(){'],
    ['/assets/general-settings-8997e171b11a.js', 'function Tc(){', 'e[17]=a,e[18]=r,e[19]=m,e[20]=h):h=e[20],h}', 'function Ec(){'],
    ['/assets/general-settings-8997e171b11a.js', 'function bc(){', 'let c;e[4]===n?c=e[5]:(c=n.formatMessage(Y.pointerCursors),e[4]=n,e[5]=c);let l;return e[6]!==o||e[7]!==s||e[8]!==c?(l=(0,$.jsx)(V,{label:i,description:a,control:(0,$.jsx)(Le,{checked:o,onChange:s,ariaLabel:c})}),e[6]=o,e[7]=s,e[8]=c,e[9]=l):l=e[9],l}', 'function xc(){'],
    ['/assets/general-settings-8997e171b11a.js', 'function Nc(){', 'e[6]=a,e[7]=c,e[8]=l,e[9]=u):u=e[9],u}', 'function Pc(){'],
    ['/assets/appearance-settings-deb0b7565185.js', 'function f(){', 'e[1]=r,e[2]=i,e[3]=s):s=e[3],s}', 'var p,m,h;'],
    ['/assets/local-conversation-turn-981410324fed.js', 'function ss(e){let t=(0,us.c)(8),', 't[5]=a,t[6]=o,t[7]=s):s=t[7],s}', 'function cs(e,t,n){'],
  ]) {
    const original = await readFile(join(rendererRoot, path));
    const adapted = adaptMigratedRendererModule(path, original);
    assert.ok(adapted.includes(Buffer.from(`from"${rendererComponentsPath}"`)));
    if (!validatedModules.has(path)) {
      await transform(adapted.toString(), { format: 'esm', target: 'es2022' });
      validatedModules.add(path);
    }
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

test('owned entry stays fresh and retired adaptation URLs have no runtime fallback', async t => {
  const root = await mkdtemp('/tmp/yard-migration-cache-');
  const fake = await createFakeCodex(root);
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  t.after(async () => { await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    dataDir: join(root, 'data'), workspace: root, hostCatalog: { hosts: [], projects: [], assignments: {} } });
  for (const path of ['app-initial-a68277f60b93.js', 'collapsible-user-message-content-636c4ff1e0ff.js', 'app-primary-f5ea123a0407.js', 'app-shared-61271c39e3c5.js', 'settings-page-25f8fd08b293.js', 'user-message-58a6f09045c4.js', 'user-message-attachments-9d0c60d2f476.js', 'general-settings-8997e171b11a.js', 'appearance-settings-deb0b7565185.js', 'sites-end-resource-b11586198b69.js', 'local-conversation-turn-981410324fed.js']) {
    // Neither a first request nor a repeated request may revive the old runtime.
    for (let request = 0; request < 2; request++) {
      const response: Response = await fetch(app.url + webRendererPrefix + '/assets/' + path);
      assert.equal(response.status, 404);
      await response.arrayBuffer();
    }
  }
  for (const path of ['/renderer-components.js', '/native-host.js']) {
    const response: Response = await fetch(app.url + path);
    assert.equal(response.status, 404, path);
    await response.arrayBuffer();
  }
  for (const path of ['/', '/workbench-entry.js', '/workbench-entry.css']) {
    const response: Response = await fetch(app.url + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await response.arrayBuffer();
  }
});
