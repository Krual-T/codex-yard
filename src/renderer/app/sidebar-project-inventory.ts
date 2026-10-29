import { captureThreadProjectMembershipExpected } from '../../native/thread-project-condition.ts';
import type { ThreadProjectConditionState } from '../../native/thread-project-condition.ts';
import type { BrowserWorkbenchClient } from './client.ts';
import type { ProjectState } from './projects.ts';
import type { SidebarHostResolution, SidebarMembershipRequest, SidebarAuthority } from './use-sidebar-behavior.ts';

interface ProjectInventory extends ProjectState, ThreadProjectConditionState {
  resolvedThreadHosts: Record<string, string[]> | null;
}
interface InventoryScope { key: string; hostId: string; threadIds: readonly string[] }

/** One native current+archived inventory per rendered list/connection epoch. */
export function createSidebarProjectInventory(client: Pick<BrowserWorkbenchClient, 'host' | 'captureDaemonConnection'>,
  current: () => InventoryScope, receive: (state: ProjectState) => void) {
  let pending: { key: string; result: Promise<{ state: ProjectInventory; assertCurrent(): void }> } | null = null;
  return async (threadId: string): Promise<SidebarHostResolution> => {
    const scope = current();
    if (!scope.threadIds.includes(threadId)) throw new Error('The original sidebar conversation is unavailable.');
    if (!pending || pending.key !== scope.key) {
      const daemon = client.captureDaemonConnection(scope.hostId);
      const assertCurrent = () => {
        daemon.assertOriginal();
        if (current().key !== scope.key) throw new Error('The original sidebar inventory changed.');
      };
      const request = { key: scope.key, result: client.host<ProjectInventory>('thread-project-state', {
        hostId: scope.hostId, daemonConnectionGeneration: daemon.generation, resolveThreadIds: [...scope.threadIds],
      }, { assertBeforeSend: assertCurrent }).then(state => {
        assertCurrent();
        if (!Array.isArray(state.membershipSources)) throw new Error('The sidebar membership observation is unavailable.');
        receive(state);
        return { state, assertCurrent };
      }) };
      pending = request;
      void request.result.catch(() => { if (pending === request) pending = null; });
    }
    const { state, assertCurrent } = await pending.result;
    assertCurrent();
    const hosts = state.resolvedThreadHosts?.[threadId];
    return { complete: state.inventory.complete && Array.isArray(hosts), hosts: hosts ? [...hosts] : [], assertCurrent };
  };
}

/** The hook supplies the original action authority and detached native snapshot. */
export async function commitSidebarProjectMembership(client: BrowserWorkbenchClient,
  request: SidebarMembershipRequest, authority: SidebarAuthority): Promise<void> {
  authority.assertBeforeSend();
  if (!authority.daemonConnectionGeneration) throw new Error('The original sidebar connection is unavailable.');
  const { row, previous, target, projectState } = request;
  if (!('membershipSources' in projectState) || !Array.isArray(projectState.membershipSources))
    throw new Error('Refresh the sidebar project membership before moving the conversation.');
  const expected = captureThreadProjectMembershipExpected(projectState as ProjectInventory,
    { hostId: row.hostId, threadId: row.id }, previous, target);
  await client.host('thread-projects', {
    hostId: row.hostId, daemonConnectionGeneration: authority.daemonConnectionGeneration, operation: 'setMembership',
    value: { hostId: row.hostId, threadId: row.id,
      assignment: target ? row.hostId === 'local' ? { projectKind: 'local', projectId: target.id }
        : { projectKind: 'remote', projectId: target.id, hostId: row.hostId } : null,
      projectless: target === null, expected },
  }, { assertBeforeSend: authority.assertBeforeSend });
}
