import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ThreadItemSummary } from '../../../lib/codex-protocol.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import type { ThreadSummaryOutput } from './ThreadSummaryPanel.tsx';
import type { ConversationSnapshot } from './conversation-sessions.ts';
import type { ProjectState } from './projects.ts';
import { projectThreadSummaryFileOutputs } from './thread-summary-file-outputs.ts';
import type { SummaryOutputDirectory, SummaryOutputOrigin, SummaryPathResolution } from './thread-summary-file-outputs.ts';
import { projectThreadSummaryResourceOutputs } from './thread-summary-outputs.ts';

export type SummaryOutputEntry =
  | (Extract<ThreadSummaryOutput, { kind: 'file' }> & { source: SummaryOutputOrigin; outputKind: 'file' | 'website'; pathResolution: SummaryPathResolution })
  | (Extract<ThreadSummaryOutput, { kind: 'link' }> & { source: { hostId: string; threadId: string; turnId: string; itemId: string; cwd?: string }; outputKind: 'resource' | 'website' });

export interface ThreadSummaryOutputsOptions {
  client: WorkbenchClient;
  hostId: string;
  threadId: string;
  snapshot: ConversationSnapshot;
  projectState: ProjectState | null;
  enabled: boolean;
  /** Must change with the parent's original page and connection/read generations. */
  sourceKey: string;
  assertCurrent(): void;
}

export interface ThreadSummaryOutputsResult {
  entries: readonly SummaryOutputEntry[];
  loading: boolean;
  error: string | null;
  notice: string | null;
  retry(): void;
  assertEntryCurrent(entry: ThreadSummaryOutput): void;
}

const projectFields = ['thread-project-assignments', 'projectless-thread-ids',
  'thread-projectless-output-directories', 'thread-workspace-root-hints'];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function outputDirectory(state: ProjectState | null, hostId: string, threadId: string): SummaryOutputDirectory {
  if (!state || !Array.isArray(state.memberships) || !Array.isArray(state.outputDirectories)
    || !Array.isArray(state.workspaceRoots) || !record(state.unresolved)) return { status: 'unknown' };
  const unresolved = state.unresolved;
  if (!record(unresolved.assignments) || !Array.isArray(unresolved.projectless)
    || !record(unresolved.outputDirectories) || !record(unresolved.workspaceRoots)
    || !record(unresolved.unreadable) || !Array.isArray(unresolved.qualified)) return { status: 'unknown' };
  if (Object.hasOwn(unresolved.assignments, threadId) || Object.hasOwn(unresolved.outputDirectories, threadId)
    || Object.hasOwn(unresolved.workspaceRoots, threadId)
    || unresolved.projectless.some(value => typeof value !== 'string' || value === threadId)
    || projectFields.some(field => Object.hasOwn(unresolved.unreadable, field))
    || unresolved.qualified.some(value => projectFields.includes(value.field)
      && (!value.hostId || value.hostId === hostId) && (value.threadId === undefined || value.threadId === threadId))) {
    return { status: 'unknown' };
  }
  const matches = <T extends { hostId: string; threadId: string }>(items: T[]) =>
    items.filter(item => item.hostId === hostId && item.threadId === threadId);
  const memberships = matches(state.memberships), roots = matches(state.workspaceRoots), outputs = matches(state.outputDirectories);
  if (memberships.length > 1 || memberships.some(value => value.projectless && value.assignment !== null)
    || roots.length > 1 || roots.some(value => !value.value.trim())
    || outputs.length > 1 || outputs.some(value => !value.value.trim())) return { status: 'unknown' };
  return outputs[0] ? { status: 'known', path: outputs[0].value } : { status: 'none' };
}

// Recognize previously identified legacy outputs without projecting arbitrary MCP text.
function recognizedLegacyOutput(item: ThreadItemSummary): boolean {
  if (item.type !== 'mcpToolCall' || item.status !== 'completed' || item.error != null
    || typeof item.tool !== 'string' || !record(item.result)) return false;
  const metadata = record(item.result._meta) ? item.result._meta : null;
  if (metadata && Object.hasOwn(metadata, 'openai/resourceActivities')) return false;
  const rawTool = item.tool.trim();
  const googleName = (value: unknown) => typeof value === 'string' && value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').includes('google-drive');
  const prefixed = /^google[\s_-]+drive(?:[\s_-]+app)?[.\s_-]+(.+)$/iu.exec(rawTool)?.[1];
  const dot = rawTool.lastIndexOf('.');
  const googleTool = prefixed ?? (dot >= 0 && googleName(rawTool.slice(0, dot)) ? rawTool.slice(dot + 1) : rawTool);
  const googleProvider = !!prefixed || dot >= 0 && googleName(rawTool.slice(0, dot)) || googleName(item.server) || googleName(item.pluginId);
  const googleWrites = ['batch_update_document', 'batch_update_presentation', 'batch_update_spreadsheet', 'copy_file',
    'create_file', 'create_folder', 'create_presentation_from_template', 'duplicate_sheet_in_new_spreadsheet',
    'import_document', 'import_presentation', 'import_spreadsheet', 'share_file'];
  const structuredContent = record(item.result.structuredContent) ? item.result.structuredContent : null;
  if (googleProvider && googleWrites.includes(googleTool) && structuredContent
    && ['documentUrl', 'document_url', 'fileUrl', 'file_url', 'presentationUrl', 'presentation_url',
      'spreadsheetUrl', 'spreadsheet_url', 'display_url', 'url', 'webViewLink', 'web_view_link']
      .some(key => typeof structuredContent[key] === 'string')) return true;
  const tool = item.tool.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-');
  if (!tool.endsWith('figma-create-new-file') && !tool.endsWith('notion-create-pages')) return false;
  if (!Array.isArray(item.result.content)) return false;
  return item.result.content.some(value => {
    if (!record(value) || value.type !== 'text' || typeof value.text !== 'string') return false;
    try {
      const parsed: unknown = JSON.parse(value.text);
      if (!record(parsed)) return false;
      if (tool.endsWith('figma-create-new-file')) return typeof parsed.file_key === 'string' && typeof parsed.file_url === 'string';
      return Array.isArray(parsed.pages) && parsed.pages.some(page => record(page) && typeof page.id === 'string'
        && typeof page.url === 'string' && record(page.properties) && typeof page.properties.title === 'string');
    } catch { return false; }
  });
}

function messageForGap(gap: string): string {
  const messages: Record<string, string> = {
    'missing-thread': 'Conversation history is not available.',
    'incomplete-history': 'Conversation history is incomplete.',
    'stream-gap': 'Conversation updates may be missing.',
    'invalid-owner': 'The output owner is unavailable.',
    'invalid-cwd': 'The conversation workspace is unavailable.',
    'unknown-output-directory': 'The output directory cannot be determined from the project state.',
    'invalid-output-directory': 'The saved output directory is invalid.',
    'invalid-citation': 'Some output citations could not be interpreted.',
    'invalid-file-change': 'A website output could not be verified from its file changes.',
    'website-appgen-unknown': 'An app-generated website cannot be resolved here.',
    'unsupported-host-path': 'Some output paths are not supported by the current host service.',
    'turn-cwd-unverified': 'Relative output paths use the thread workspace; the original turn workspace is unverified.',
    'assistant-envelope-unsupported': 'Some assistant output requires unsupported preprocessing.',
    'invalid-resource-activities': 'Some resource output metadata is invalid.',
    'unknown-provider-scope': 'Some resource outputs lack a verified provider identity.',
    'page-resource': 'Some Page outputs require the original access and availability checks.',
    'legacy-tool-result': 'Some recognized legacy app outputs are not yet available.',
  };
  return messages[gap] ?? `Output source is incomplete: ${gap}.`;
}

function immutableEntry(entry: SummaryOutputEntry): SummaryOutputEntry {
  if (entry.kind === 'file') return Object.freeze({ ...entry, source: Object.freeze({ ...entry.source }) });
  return Object.freeze({ ...entry, source: Object.freeze({ ...entry.source }) });
}

interface Saved {
  scope: ThreadSummaryOutputsOptions & { attempt: number; connectionRevision: number };
  entries: readonly SummaryOutputEntry[];
  loading: boolean;
  error: string | null;
  notice: string | null;
}

/** Read-only projection of the current conversation's known Outputs sources. */
export function useThreadSummaryOutputs(options: ThreadSummaryOutputsOptions): ThreadSummaryOutputsResult {
  const { client, hostId, threadId, snapshot, projectState, enabled, sourceKey, assertCurrent } = options;
  const [attempt, setAttempt] = useState(0), [connectionRevision, setConnectionRevision] = useState(0);
  // The parent supplies a fresh closure on render; sourceKey carries its authority epoch.
  const scope = useMemo(() => ({ client, hostId, threadId, snapshot, projectState, enabled, sourceKey, assertCurrent, attempt, connectionRevision }),
    [client, hostId, threadId, snapshot, projectState, enabled, sourceKey, attempt, connectionRevision]);
  const current = useRef<typeof scope | null>(scope); current.current = scope;
  const [saved, setSaved] = useState<Saved | null>(null);
  const savedRef = useRef(saved); savedRef.current = saved;

  useLayoutEffect(() => {
    current.current = scope;
    return () => { if (current.current === scope) current.current = null; };
  }, [scope]);

  useEffect(() => {
    if (!enabled) return;
    return client.subscribe(event => {
      if (event.type === 'page-resumed' || event.type === 'connection-state'
        || event.type === 'codex-app-server-connection-changed' && event.hostId === hostId) {
        current.current = null;
        setConnectionRevision(value => value + 1);
      }
    });
  }, [client, hostId, enabled]);

  useEffect(() => {
    let active = true;
    const check = () => {
      if (!active || current.current !== scope || !scope.enabled) throw new Error('The original summary output source changed.');
      scope.assertCurrent();
      if (!active || current.current !== scope) throw new Error('The original summary output source changed.');
    };
    const publish = (entries: readonly SummaryOutputEntry[], loading: boolean, error: string | null, notice: string | null) => {
      if (active && current.current === scope) setSaved({ scope, entries: Object.freeze([...entries]), loading, error, notice });
    };
    if (!scope.enabled) return () => { active = false; };
    const run = async () => {
      let known: readonly SummaryOutputEntry[] = [], notice: string | null = null;
      try {
        check();
        if (scope.snapshot.thread && scope.snapshot.thread.id !== scope.threadId) throw new Error('The summary history belongs to another conversation.');
        if (!scope.hostId || !scope.threadId) throw new Error('The summary output owner is unavailable.');
        const thread = scope.snapshot.thread;
        const file = projectThreadSummaryFileOutputs({ hostId: scope.hostId, thread,
          historyComplete: scope.snapshot.historyComplete, streamGap: scope.snapshot.streamGap,
          outputDirectory: outputDirectory(scope.projectState, scope.hostId, scope.threadId) });
        const resource = projectThreadSummaryResourceOutputs({ hostId: scope.hostId, thread,
          historyComplete: scope.snapshot.historyComplete, streamGap: scope.snapshot.streamGap });
        const gaps = new Set<string>([...file.gaps, ...resource.gaps.filter(gap => gap !== 'legacy-tool-result')]);
        if (resource.gaps.includes('legacy-tool-result') && thread?.turns?.some(turn => turn.items?.some(recognizedLegacyOutput))) gaps.add('legacy-tool-result');
        const notices = [...gaps].map(messageForGap);
        if (scope.snapshot.error) notices.push(`Conversation history: ${scope.snapshot.error}`);
        notice = notices.length ? notices.join(' ') : null;

        const entries: SummaryOutputEntry[] = [];
        for (const entry of resource.entries) entries.push(immutableEntry({ ...entry, id: `resource:${entry.id}`, outputKind: 'resource' }));
        for (const entry of file.ordered) {
          if (entry.kind === 'file') entries.push(immutableEntry({ ...entry, outputKind: 'file' }));
          else if (entry.target.type === 'url') entries.push(immutableEntry({ kind: 'link', id: `website:${entry.target.url}`,
            label: entry.target.url, url: entry.target.url, source: entry.source, outputKind: 'website' }));
          else entries.push(immutableEntry({ kind: 'file', id: `website:${entry.target.path}`, label: entry.target.path.split('/').at(-1) ?? entry.target.path,
            path: entry.target.path, source: entry.source, outputKind: 'website', pathResolution: entry.target.pathResolution }));
        }
        const turnOrder = new Map((thread?.turns ?? []).map((turn, index, all) => [turn.id, all.length - index]));
        entries.sort((left, right) => (turnOrder.get(left.source.turnId) ?? Infinity) - (turnOrder.get(right.source.turnId) ?? Infinity));
        const paths = [...new Set(entries.flatMap(entry => entry.kind === 'file' ? [entry.path] : []))];
        known = entries.filter(entry => entry.kind === 'link');
        if (!paths.length) { check(); publish(entries, scope.snapshot.loading, null, notice); return; }
        publish(known, true, null, notice);
        check();
        const response = await scope.client.host<{ existingPaths: unknown }>('paths-exist', { hostId: scope.hostId, paths }, { assertBeforeSend: check });
        check();
        if (!Array.isArray(response?.existingPaths) || !response.existingPaths.every(path => typeof path === 'string' && paths.includes(path))) {
          throw new Error('Invalid paths-exist response.');
        }
        const existing = new Set(response.existingPaths);
        publish(entries.filter(entry => entry.kind === 'link' || existing.has(entry.path)), scope.snapshot.loading, null, notice);
      } catch (cause) {
        if (active && current.current === scope) {
          try { check(); }
          catch (invalid) {
            publish([], false, invalid instanceof Error ? invalid.message : String(invalid), null);
            return;
          }
          publish(known, false, cause instanceof Error ? cause.message : String(cause), notice);
        }
      }
    };
    void run();
    return () => { active = false; };
  }, [scope]);

  const retry = useCallback(() => {
    if (current.current !== scope || !scope.enabled) return;
    current.current = null;
    setAttempt(value => value + 1);
  }, [scope]);
  const assertEntryCurrent = useCallback((entry: ThreadSummaryOutput) => {
    if (current.current !== scope || !scope.enabled) throw new Error('The original summary output source changed.');
    scope.assertCurrent();
    const result = savedRef.current;
    if (current.current !== scope || result?.scope !== scope || !result.entries.some(value => value === entry)
      || !('source' in entry) || entry.source?.hostId !== scope.hostId || entry.source.threadId !== scope.threadId) {
      throw new Error('The original summary output is no longer current.');
    }
  }, [scope]);
  const visible = saved?.scope === scope ? saved : null;
  return { entries: visible?.entries ?? [], loading: enabled && (visible?.loading ?? true),
    error: visible?.error ?? null, notice: visible?.notice ?? null, retry, assertEntryCurrent };
}
