import type { SettingsProjectRoots, SettingsSessionCwd } from '../settings/scope.ts';
import { validScopePath } from '../settings/scope.ts';
import { projectsForHost } from './projects.ts';
import type { Project, ProjectState } from './projects.ts';

const stateKey = '__yardSettingsOrigin';
export const settingsOriginParameter = 'yardSettingsOrigin';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
export interface SettingsOrigin {
  hostId: string;
  returnTo: string;
  source: { kind: 'thread'; threadId: string } | { kind: 'project'; projectId: string } | { kind: 'none' };
}
export interface SettingsContext { projectRoots: SettingsProjectRoots | null; sessionCwd: SettingsSessionCwd | null }
export const emptySettingsContext: SettingsContext = { projectRoots: null, sessionCwd: null };

function originValue(input: unknown): SettingsOrigin | null {
  const value = record(input), source = record(value.source);
  if (typeof value.hostId !== 'string' || !value.hostId || typeof value.returnTo !== 'string'
    || !value.returnTo.startsWith('/') || value.returnTo.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value.returnTo)) return null;
  if (new URL(value.returnTo, 'https://yard.invalid').origin !== 'https://yard.invalid') return null;
  if (source.kind === 'thread' && typeof source.threadId === 'string' && source.threadId) {
    return { hostId: value.hostId, returnTo: value.returnTo, source: { kind: 'thread', threadId: source.threadId } };
  }
  if (source.kind === 'project' && typeof source.projectId === 'string' && source.projectId) {
    return { hostId: value.hostId, returnTo: value.returnTo, source: { kind: 'project', projectId: source.projectId } };
  }
  return source.kind === 'none' ? { hostId: value.hostId, returnTo: value.returnTo, source: { kind: 'none' } } : null;
}

/** Read old history entries only to import their identity into the URL. */
export function readSettingsOrigin(state: unknown): SettingsOrigin | null { return originValue(record(state)[stateKey]); }

export function readSettingsOriginURL(search: string): SettingsOrigin | null {
  const value = new URLSearchParams(search).get(settingsOriginParameter);
  try { return value ? originValue(JSON.parse(value)) : null; } catch { return null; }
}

export function settingsOriginURL(path: string, origin: SettingsOrigin | null): string {
  const url = new URL(path, 'https://yard.invalid');
  if (url.origin !== 'https://yard.invalid') throw new Error('Settings navigation must stay on this Yard origin.');
  if (origin) {
    if (!originValue(origin)) throw new Error('The settings source or return route is invalid.');
    url.searchParams.set(settingsOriginParameter, JSON.stringify(origin));
  }
  return url.pathname + url.search + url.hash;
}

export function captureSettingsOrigin(route: { hostId: string; threadId: string | null; pathname: string; search: string; hash: string },
  project: Project | null): SettingsOrigin {
  return { hostId: route.hostId, returnTo: route.pathname + route.search + route.hash,
    source: route.threadId ? { kind: 'thread', threadId: route.threadId }
      : project?.hostId === route.hostId ? { kind: 'project', projectId: project.id } : { kind: 'none' } };
}

/** URLs store identities. Paths are resolved from the selected host's authority. */
export async function resolveSettingsOrigin(origin: SettingsOrigin | null, hostId: string, state: ProjectState | null,
  readThread: (hostId: string, threadId: string) => Promise<unknown>): Promise<SettingsContext> {
  if (!origin || origin.source.kind === 'none') return emptySettingsContext;
  if (origin.hostId !== hostId) return emptySettingsContext;
  if (!state) throw new Error('The settings source project catalog has not loaded.');
  const projects = projectsForHost(state, hostId);
  if (origin.source.kind === 'project') {
    const projectId = origin.source.projectId;
    const project = projects.find(value => value.id === projectId);
    if (!project || !project.rootPaths.length || !project.rootPaths.every(validScopePath)) throw new Error('The source project is unavailable. Its previous paths have not been reused.');
    return { projectRoots: { hostId, paths: project.rootPaths }, sessionCwd: null };
  }
  const threadId = origin.source.threadId, thread = record(record(await readThread(hostId, threadId)).thread);
  if (thread.id !== threadId || !validScopePath(thread.cwd)) throw new Error('The source conversation working directory could not be verified.');
  const membership = state.memberships.find(value => value.hostId === hostId && value.threadId === threadId);
  const unresolved = state.unresolved;
  if (!membership && (Object.hasOwn(unresolved.assignments, threadId) || unresolved.projectless.includes(threadId)
    || unresolved.qualified.some(value => value.hostId === hostId && value.threadId === threadId))) {
    throw new Error('The source conversation project membership is unresolved. Its scope has not been guessed.');
  }
  const assignment = membership?.assignment;
  const project = assignment ? projects.find(value => value.id === assignment.projectId
    && (assignment.projectKind === 'local' ? hostId === 'local' : hostId !== 'local' && (!assignment.hostId || assignment.hostId === hostId))) : null;
  if (assignment && (!project || !project.rootPaths.length || !project.rootPaths.every(validScopePath))) {
    throw new Error('The source conversation project is unavailable. Its working directory has not been substituted for the project.');
  }
  return { projectRoots: project ? { hostId, paths: project.rootPaths } : null, sessionCwd: { hostId, path: thread.cwd } };
}
