import { BrowserHttpFetch } from '../../native/browser-http-fetch.ts';

type OriginalRead =
  | { kind: 'project'; projectId: string }
  | { kind: 'shared-task'; postId: string }
  | { kind: 'task-share'; automationId: string }
  | { kind: 'task-detail'; automationId: string }
  | { kind: 'task-run'; automationId: string; runId: string | null };

/** The existing browser bridge can report its actual rejection, but cannot establish a host identity. */
export async function readThroughOriginalBridge(read: OriginalRead, signal: AbortSignal): Promise<never> {
  if (signal.aborted) throw new DOMException('The selected page changed.', 'AbortError');
  const url = new URL('https://chatgpt.com/backend-api/');
  if (read.kind === 'project') {
    url.pathname += `gizmos/${encodeURIComponent(read.projectId)}`;
    url.searchParams.set('include_file_limits', 'true');
  } else if (read.kind === 'shared-task') {
    url.pathname += `share/post/${encodeURIComponent(read.postId)}/automation`;
  } else if (read.kind === 'task-share') {
    url.pathname += `share/automation/${encodeURIComponent(read.automationId)}/current`;
  } else if (read.kind === 'task-detail') {
    url.pathname += `automation/${encodeURIComponent(read.automationId)}`;
  } else {
    url.pathname += `automation/${encodeURIComponent(read.automationId)}/runs/${read.runId === null ? 'latest' : encodeURIComponent(read.runId)}`;
  }
  const bridge = new BrowserHttpFetch();
  const id = crypto.randomUUID();
  const pending = bridge.fetch(id, { url: url.href, method: 'GET' });
  const cancel = () => bridge.cancel(id);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await pending;
    if ('error' in result) throw new Error(result.error);
    const response = result.response;
    await response.body?.cancel();
    if (!response.ok) throw new Error(`The product request failed (${response.status}).`);
    throw new Error('The response cannot be associated with the selected host and account.');
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
