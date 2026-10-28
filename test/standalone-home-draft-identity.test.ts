import assert from 'node:assert/strict';
import test from 'node:test';
import { homeDraftIdentity, selectHomeDraftIdentity } from '../src/renderer/app/home-draft-identity.ts';
import { sendThreadKey } from '../src/renderer/app/send-recovery.ts';

test('a created thread consumes only its host home pointer, keeping the next home draft stable through reload', () => {
  let value: string | null = '00000000-0000-4000-8000-000000000001';
  const original = value;
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
  assert.equal(homeDraftIdentity('local', {}, storage), original);
  const bindings = { [sendThreadKey('local', 'created')]: original };
  const nextHome = homeDraftIdentity('local', bindings, storage);
  assert.notEqual(nextHome, original);
  assert.equal(homeDraftIdentity('local', bindings, storage), nextHome);
  assert.equal(homeDraftIdentity('ssh-fixture', bindings, storage), original);
  const remoteHome = '00000000-0000-4000-8000-000000000002';
  selectHomeDraftIdentity('ssh-fixture', remoteHome, storage);
  assert.equal(homeDraftIdentity('local', bindings, storage), nextHome);
  assert.equal(homeDraftIdentity('ssh-fixture', bindings, storage), remoteHome);
  assert.equal(JSON.parse(value!).legacyId, original);
});

test('unknown identity data and a failed pointer publication never overwrite the stored home identity', () => {
  let value = '{"version":99,"future":true}';
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
  assert.throws(() => homeDraftIdentity('local', {}, storage), /原记录已保留/);
  assert.equal(value, '{"version":99,"future":true}');
  value = '00000000-0000-4000-8000-000000000001';
  assert.throws(() => homeDraftIdentity('local', {}, { ...storage, setItem: () => { throw new Error('quota'); } }), /quota/);
  assert.equal(value, '00000000-0000-4000-8000-000000000001');
});
