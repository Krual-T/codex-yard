import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtinPetAssets, miniShortcut, petFrame, petSize, readPetOptions, readPetState } from '../src/renderer/mini/model.ts';

test('Mini reads persisted state and legacy/custom avatar shapes without rewriting unknown selections', () => {
  assert.equal(readPetState({ isOpen: 'yes' }), null);
  assert.deepEqual(readPetState({ isOpen: true, visibility: 'on-demand', position: { x: .2, y: .8 } }),
    { isOpen: true, visibility: 'on-demand', position: { x: .2, y: .8 } });
  assert.equal(readPetState({ isOpen: true, position: { x: 2, y: 0 } })?.position, null);
  const options = readPetOptions({ avatars: [
    { id: 'custom:legacy', displayName: 'Legacy', spriteVersionNumber: 1, spritesheetDataUrl: 'data:image/png;base64,AA==' },
    { id: 'custom:new', displayName: 'New', spriteVersionNumber: 2, spritesheetDataUrl: 'data:image/webp;base64,AA==' },
    { id: 'custom:bad', displayName: 'Bad', spriteVersionNumber: 3, spritesheetDataUrl: 'data:image/png;base64,AA==' },
    { id: 'custom:url', displayName: 'Unsafe', spriteVersionNumber: 1, spritesheetDataUrl: 'https://invalid.example/pet' },
  ] });
  assert.equal(options.find(pet => pet.id === 'custom:legacy')?.rows, 9);
  assert.equal(options.find(pet => pet.id === 'custom:new')?.rows, 11);
  assert.equal(options.find(pet => pet.id === 'codex')?.src, builtinPetAssets.codex);
  assert.equal(options.some(pet => pet.id === 'custom:bad' || pet.id === 'custom:url'), false);
  assert.equal(petSize(224), 224);
  assert.equal(petSize(225), 112);
  assert.deepEqual(petFrame('waiting', 5), { row: 6, column: 5, duration: 260 });
  assert.deepEqual(petFrame('idle', 6), { row: 0, column: 0, duration: 1680 });
});

test('Mini shortcut matches the original platform defaults without repeated or modified triggers', () => {
  const key = { key: 'p', metaKey: true, altKey: true, ctrlKey: false, shiftKey: false, repeat: false, isComposing: false };
  assert.equal(miniShortcut(key, false), true);
  assert.equal(miniShortcut({ ...key, repeat: true }, false), false);
  assert.equal(miniShortcut({ ...key, ctrlKey: true }, false), false);
  assert.equal(miniShortcut({ ...key, key: ' ', metaKey: false }, true), true);
  assert.equal(miniShortcut({ ...key, key: ' ', metaKey: true }, true), false);
});
