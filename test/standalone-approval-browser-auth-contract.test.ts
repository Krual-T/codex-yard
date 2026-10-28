import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyElicitation } from '../src/renderer/app/approval-elicitation.ts';

test('browser auth accepts only an explicit payload or a safe HTTPS initial QR URL', () => {
  const params = { mode:'form', serverName:'node_repl', requestedSchema:{type:'object',properties:{}},
    _meta:{codex_approval_kind:'browser_auth',browser_auth_challenge_id:'a'.repeat(32),
      origin:'https://example.test',reason:'Sign in',fields:[],qrCodeUrl:'https://example.test/qr'} };
  const view = classifyElicitation(params);
  assert.equal(view.kind, 'browser-auth');
  if (view.kind !== 'browser-auth') return;
  assert.equal(view.initialQrPayload, 'https://example.test/qr');
  assert.equal(view.qrCode, false);
  for (const url of ['http://example.test/qr', 'https://user:pass@example.test/qr', 'javascript:alert(1)']) {
    const unsafe = classifyElicitation({...params,_meta:{...params._meta,qrCodeUrl:url}});
    assert.equal(unsafe.kind, 'browser-auth');
    if (unsafe.kind === 'browser-auth') {
      assert.equal(unsafe.initialQrPayload, undefined);
      assert.equal(unsafe.hasQrCode, false);
    }
  }
  const opaque = classifyElicitation({...params,_meta:{...params._meta,qrCodePayload:'opaque-synthetic-value',qrCode:true}});
  assert.equal(opaque.kind, 'browser-auth');
  if (opaque.kind === 'browser-auth') {
    assert.equal(opaque.initialQrPayload, 'opaque-synthetic-value');
    assert.equal(opaque.qrCode, true);
  }
});
