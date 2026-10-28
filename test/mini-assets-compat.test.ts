import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPetAssets } from '../src/native/pet-assets.ts';

test('custom pet discovery preserves legacy avatars and prefers the new manifest when both exist', async t => {
  const home = await mkdtemp('/tmp/yard-mini-assets-');
  t.after(() => rm(home, { recursive: true, force: true }));
  const assets = createPetAssets(home);
  const image = (height: number) => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.write('IHDR', 12); png.writeUInt32BE(1536, 16); png.writeUInt32BE(height, 20);
    return png;
  };
  const legacy = join(home, 'avatars', 'shared');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'avatar.json'), JSON.stringify({ displayName: 'Legacy' }));
  await writeFile(join(legacy, 'spritesheet.webp'), image(1872));
  const before = await readFile(join(legacy, 'avatar.json'), 'utf8');
  assert.equal((await assets.loadAvatar('custom:shared'))?.spriteVersionNumber, 1);
  const modern = join(home, 'pets', 'shared');
  await mkdir(modern, { recursive: true });
  await writeFile(join(modern, 'pet.json'), JSON.stringify({ displayName: 'Modern', spriteVersionNumber: 2 }));
  await writeFile(join(modern, 'spritesheet.webp'), image(2288));
  assert.equal((await assets.load()).avatars.length, 1);
  assert.equal((await assets.loadAvatar('custom:shared'))?.displayName, 'Modern');
  assert.equal(await readFile(join(legacy, 'avatar.json'), 'utf8'), before);
  await writeFile(join(modern, 'pet.json'), JSON.stringify({ spriteVersionNumber: 99 }));
  assert.equal((await assets.loadAvatar('custom:shared'))?.displayName, 'Legacy');
});
