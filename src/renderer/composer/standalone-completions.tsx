import { useEffect, useId, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';

export type Completion = { kind: 'file' | 'directory'; name: string; path: string }
  | { kind: 'skill'; name: string; path: string; description: string }
  | { kind: 'command'; name: 'model'; description: string };
interface Query { kind: 'file' | 'skill'; start: number; end: number; directory: string; term: string; token: string }
interface Result { key: string; items: Completion[]; loading: boolean; error: string }
function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function queryAt(text: string, cursor: number): Query | null {
  const before = text.slice(0, cursor);
  const inline = before.match(/(?:^|\s)([@$])([^\s@$\ufffc]*)$/);
  const slash = before.match(/(?:^|\n)[ \t]*\/([^\s/\ufffc]*)$/);
  if (!inline && !slash) return null;
  const trigger = inline?.[1] ?? '/';
  const token = inline?.[2] ?? slash?.[1] ?? '';
  if (trigger !== '@') {
    if (token.includes('/')) return null;
    return { kind: 'skill', start: cursor - token.length - 1, end: cursor, directory: '', term: token, token: trigger + token };
  }
  if (token.startsWith('/') || token.includes('\\') || token.split('/').some(part => part === '..' || part === '.')) return null;
  const separator = token.lastIndexOf('/');
  return { kind: 'file', start: cursor - token.length - 1, end: cursor,
    directory: separator < 0 ? '' : token.slice(0, separator), term: token.slice(separator + 1), token: '@' + token };
}
async function load(client: WorkbenchClient, hostId: string, cwd: string, query: Query, busy: boolean): Promise<Completion[]> {
  const term = query.term.toLocaleLowerCase();
  if (query.kind === 'file') {
    const response = record(await client.host('workspace-directory-entries', {
      hostId, workspaceRoot: cwd, directoryPath: query.directory,
    }));
    if (!Array.isArray(response.entries)) throw new Error('文件列表响应无效');
    return response.entries.flatMap<Completion>(entry => {
      const item = record(entry);
      if (typeof item.name !== 'string' || typeof item.path !== 'string' || !item.name.toLocaleLowerCase().includes(term)
        || item.type !== 'file' && item.type !== 'directory') return [];
      return [{ kind: item.type, name: item.name, path: item.path }];
    }).slice(0, 30);
  }
  const response = record(await client.rpc('skills/list', { cwds: [cwd] }, hostId));
  if (!Array.isArray(response.data)) throw new Error('技能列表响应无效');
  const seen = new Set<string>(), items: Completion[] = query.token.startsWith('/') && !busy && 'model'.includes(term)
    ? [{ kind: 'command', name: 'model', description: '选择模型' }] : [];
  for (const group of response.data) {
    const skills = record(group).skills;
    if (!Array.isArray(skills)) continue;
    for (const raw of skills) {
      const skill = record(raw);
      if (skill.enabled !== true || typeof skill.name !== 'string' || !skill.name || typeof skill.path !== 'string' || !skill.path
        || !skill.name.toLocaleLowerCase().includes(term) || seen.has(skill.path)) continue;
      seen.add(skill.path);
      const description = typeof skill.shortDescription === 'string' ? skill.shortDescription
        : typeof skill.short_description === 'string' ? skill.short_description
          : typeof skill.description === 'string' ? skill.description : '';
      items.push({ kind: 'skill', name: skill.name, path: skill.path, description });
    }
  }
  return items.slice(0, 30);
}

export function useCompletions(client: WorkbenchClient, hostId: string, cwd: string, text: string, cursor: number, busy: boolean, scope = '') {
  const listId = useId();
  const [dismissed, setDismissed] = useState('');
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<Result>({ key: '', items: [], loading: false, error: '' });
  const query = queryAt(text, cursor);
  const queryKey = query ? JSON.stringify([hostId, cwd, scope, query.kind, query.start, query.token, busy]) : '';
  const active = queryKey && queryKey !== dismissed ? query : null;
  useEffect(() => {
    if (!active || !cwd) return;
    let live = true;
    setIndex(0);
    setResult({ key: queryKey, items: [], loading: true, error: '' });
    const timer = setTimeout(() => {
      void load(client, hostId, cwd, active, busy).then(items => {
        if (live) setResult({ key: queryKey, items, loading: false, error: '' });
      }).catch(error => {
        if (live) setResult({ key: queryKey, items: [], loading: false, error: error instanceof Error ? error.message : String(error) });
      });
    }, 100);
    return () => { live = false; clearTimeout(timer); };
  }, [client, hostId, cwd, queryKey, dismissed]);
  const current = active && result.key === queryKey ? result : { key: queryKey, items: [], loading: !!active, error: '' };
  const selected = Math.min(index, current.items.length - 1);
  return {
    query: active, listId, items: current.items, selected, loading: current.loading, error: current.error,
    move(delta: number) { if (current.items.length) setIndex((selected + delta + current.items.length) % current.items.length); },
    dismiss() { setDismissed(queryKey); },
    show() { setDismissed(''); },
  };
}
