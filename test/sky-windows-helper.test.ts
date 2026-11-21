import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { projectRoot } from '../lib/app-resources.ts';

test('Windows Sky waits for a pending native action before end_turn and close on EOF', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'yard-windows-sky-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const helper = join(dir, 'helper.mjs'), log = join(dir, 'calls.jsonl');
  await writeFile(helper, `import {createInterface} from 'node:readline'; import {appendFileSync} from 'node:fs';
const input=createInterface({input:process.stdin}); let held=false;
input.on('line', async line=>{const request=JSON.parse(line); appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(request)+'\\n');
if(request.method==='hold') {await new Promise(r=>setTimeout(r,100)); held=true;}
if(request.method==='end_turn') held=false;
process.stdout.write(JSON.stringify({id:request.id,ok:true,result:null})+'\\n');
if(request.method==='close') {if(held)process.exitCode=3; input.close(); process.stdin.destroy();}
});`);
  const url = pathToFileURL(join(projectRoot, 'lib/sky-windows-helper.ts')).href;
  // EOF arrives while the native request is still executing.
  const script = `import {runWindowsSkyHelper} from ${JSON.stringify(url)};runWindowsSkyHelper(process.execPath,[${JSON.stringify(helper)}]);`;
  const child = execFile(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, FIXTURE_LOG: log } });
  const done = new Promise<void>((resolve, reject) => child.once('error', reject).once('exit', code => code === 0 ? resolve() : reject(new Error('launcher exit ' + code))));
  child.stdin!.end(JSON.stringify({ id: 1, method: 'hold', params: {}, meta: { session_id: 'fixture', turn_id: 'turn-1' } }) + '\n');
  await done;
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.map(call => call.method), ['hold', 'end_turn', 'close']);
  assert.deepEqual(calls[1].meta, calls[0].meta);
});

test('Windows Sky reports cleanup rejection instead of leaving a successful exit', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'yard-windows-sky-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const helper = join(dir, 'helper.mjs');
  await writeFile(helper, `import {createInterface} from 'node:readline';const input=createInterface({input:process.stdin});input.on('line',line=>{const request=JSON.parse(line);process.stdout.write(JSON.stringify({id:request.id,ok:request.method!=='end_turn',error:'fixture cleanup failed'})+'\\n');if(request.method==='close'){input.close();process.stdin.destroy();}});`);
  const url = pathToFileURL(join(projectRoot, 'lib/sky-windows-helper.ts')).href;
  const child = execFile(process.execPath, ['--input-type=module', '-e', `import {runWindowsSkyHelper} from ${JSON.stringify(url)};runWindowsSkyHelper(process.execPath,[${JSON.stringify(helper)}]);`]);
  let stderr = ''; child.stderr!.on('data', value => { stderr += value; });
  const done = new Promise<number | null>((resolve, reject) => child.once('error', reject).once('exit', resolve));
  child.stdin!.end();
  assert.equal(await done, 1);
  assert.match(stderr, /end_turn failed: fixture cleanup failed/);
});
