import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readProductRoute } from '../src/renderer/app/product-routes.ts';

test('product routes preserve parameters, empty project IDs, state and unknown targets', () => {
  const location = { pathname: '/projects', search: '?projectId=&hostId=ssh', hash: '#part', state: { from: 'thread' } };
  const project = readProductRoute(location);
  assert.equal(project.kind, 'projects');
  if (project.kind === 'projects') assert.equal(project.projectId, '');
  assert.equal(project.location, location);
  const index = readProductRoute({ ...location, search: '?hostId=ssh' });
  assert.equal(index.kind === 'projects' && index.projectId, null);
  const agent = readProductRoute({ ...location, pathname: '/agents/studio/edit/a%2Fb' });
  assert.equal(agent.kind === 'agent-edit' && agent.agentId, 'a/b');
  assert.equal(readProductRoute({ ...location, pathname: '/agents/a/%ZZ' }).kind, 'invalid');
  for (const [path, id] of [['/g/g-p-123-title/project', 'g-p-123'], ['/g/g-abc-title/project', 'g-abc'], ['/g/foo%2Fbar/project', 'foo/bar'], ['/g/%ZZ/project', '%ZZ']] as const) {
    const route = readProductRoute({ ...location, pathname: path });
    assert.equal(route.kind === 'legacy-project' && route.projectId, id);
  }
  const auto = readProductRoute({ ...location, pathname: '/automations', search: '?view=shared_task&automationId=a%2Fb&automationMode=create' });
  assert.equal(auto.kind, 'automations');
  if (auto.kind === 'automations') assert.deepEqual([auto.view, auto.automationId, auto.automationMode], ['shared_task', 'a/b', 'create']);
  const linked = readProductRoute({ ...location, pathname: '/scheduled', search: '?shared_task=p%2F1&share_dialog=true&automationSource=cloud&runId=latest' });
  if (linked.kind !== 'automations') assert.fail('expected scheduled route');
  assert.deepEqual([linked.sharedTask, linked.shareDialog, linked.automationSource, linked.runId], ['p/1', true, 'cloud', 'latest']);
  const falseShare = readProductRoute({ ...location, pathname: '/scheduled', search: '?shared_task=&share_dialog=false' });
  assert.equal(falseShare.kind === 'automations' && falseShare.sharedTask, '');
  assert.equal(falseShare.kind === 'automations' && falseShare.shareDialog, false);
  const edit = readProductRoute({ ...location, pathname: '/scheduled', search: '?edit_modal=true&automationTeamId=team%2F1&automationDraftId=draft%2F2' });
  if (edit.kind !== 'automations') assert.fail('expected scheduled route');
  assert.deepEqual([edit.automationEditing, edit.automationTeamId, edit.automationDraftId], [true, 'team/1', 'draft/2']);
  for (const query of ['?edit=true', '?automationMode=edit']) {
    const route = readProductRoute({ ...location, pathname: '/scheduled', search: query });
    assert.equal(route.kind === 'automations' && route.automationEditing, true);
  }
  assert.equal(readProductRoute({ ...location, pathname: '/plugins/p/app/t' }).kind, 'other');
  assert.equal(readProductRoute({ ...location, pathname: '/space/file/f' }).kind, 'other');
  for (const [pathname, target] of [['/explore', '/'], ['/mission-control', '/'], ['/dots', '/dots/home']] as const) {
    const redirect = readProductRoute({ ...location, pathname });
    assert.equal(redirect.kind === 'redirect' && redirect.to, target);
  }
});
