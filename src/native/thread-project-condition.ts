import type { IdentifiedMembership, ThreadIdentity, ThreadProjectSnapshot } from './thread-projects.ts';

type JsonObject = Record<string, unknown>;
export type ProjectConditionSlot = { state: 'missing' } | { state: 'value'; value: unknown } | { state: 'unreadable'; value: unknown };
export interface ThreadProjectMembershipSource extends ThreadIdentity {
  assignment: { legacy: ProjectConditionSlot; qualified: ProjectConditionSlot };
  projectless: { legacy: ProjectConditionSlot; qualified: ProjectConditionSlot };
}
export interface ThreadProjectRootIdentity { hostId: string; id: string; rootPaths: readonly string[] }
export interface ThreadProjectConditionState extends ThreadProjectSnapshot {
  catalog: { local: unknown; remote: unknown };
  membershipSources: readonly ThreadProjectMembershipSource[];
}
export interface ThreadProjectMembershipExpected {
  identity: ThreadIdentity;
  source: ThreadProjectRootIdentity | null;
  target: ThreadProjectRootIdentity | null;
  observed: {
    raw: ThreadProjectMembershipSource;
    membership: IdentifiedMembership | null;
    unresolvedAssignment: ProjectConditionSlot;
    unresolvedProjectlessCount: number;
    unreadableAssignment: ProjectConditionSlot;
    unreadableProjectless: ProjectConditionSlot;
    unresolvedQualified: ThreadProjectSnapshot['unresolved']['qualified'];
  };
}

const assignmentKey = 'thread-project-assignments';
const projectlessKey = 'projectless-thread-ids';
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const missing = (): ProjectConditionSlot => ({ state: 'missing' });
const present = (value: unknown): ProjectConditionSlot => ({ state: 'value', value });
const unreadable = (value: unknown): ProjectConditionSlot => ({ state: 'unreadable', value });
const entry = (value: JsonObject, key: string): ProjectConditionSlot => Object.hasOwn(value, key) ? present(value[key]) : missing();

function sourceFor(raw: unknown, identity: ThreadIdentity, projectless: boolean) {
  let legacy = raw, hosts: JsonObject = {};
  if (object(raw) && raw.$codexYardThreadProjects === 1) {
    if (!Object.hasOwn(raw, 'legacy') || !object(raw.hosts)) {
      return { legacy: unreadable(raw), qualified: unreadable(raw) };
    }
    legacy = raw.legacy;
    hosts = raw.hosts;
  }
  let old: ProjectConditionSlot;
  if (legacy === undefined) old = missing();
  else if (projectless && Array.isArray(legacy)) {
    const count = legacy.filter(value => value === identity.threadId).length;
    old = count ? present(count) : missing();
  } else if (!projectless && object(legacy)) old = entry(legacy, identity.threadId);
  else old = unreadable(legacy);
  const host = Object.hasOwn(hosts, identity.hostId) ? hosts[identity.hostId] : undefined;
  const qualified = host === undefined ? missing() : object(host) ? entry(host, identity.threadId) : unreadable(host);
  return { legacy: old, qualified };
}

/** Only the requested host/thread slots are projected; other globals remain authoritative. */
export function observeThreadProjectMembershipSources(globals: JsonObject, identities: readonly ThreadIdentity[]): ThreadProjectMembershipSource[] {
  return identities.map(identity => ({ ...identity,
    assignment: sourceFor(globals[assignmentKey], identity, false),
    projectless: sourceFor(globals[projectlessKey], identity, true),
  }));
}

function projectRoots(catalog: ThreadProjectConditionState['catalog'], project: ThreadProjectRootIdentity): string[] {
  if (!project.hostId || !project.id || !Array.isArray(project.rootPaths) || project.rootPaths.some(path => typeof path !== 'string'))
    throw new Error('Invalid project identity or roots.');
  let entries: unknown[];
  if (project.hostId === 'local') {
    if (!object(catalog.local)) throw new Error('The local project catalog is unreadable.');
    entries = Object.values(catalog.local);
  } else {
    if (!Array.isArray(catalog.remote)) throw new Error('The remote project catalog is unreadable.');
    entries = catalog.remote;
  }
  if (entries.some(value => !object(value) || typeof value.id !== 'string' || project.hostId !== 'local' && typeof value.hostId !== 'string'))
    throw new Error('The project catalog contains an unreadable identity.');
  const matches = entries.filter(value => object(value) && value.id === project.id &&
    (project.hostId === 'local' || value.hostId === project.hostId));
  if (matches.length !== 1 || !object(matches[0])) throw new Error('The original project identity is unavailable or ambiguous.');
  const selected = matches[0];
  const roots = project.hostId === 'local' ? selected.rootPaths : typeof selected.remotePath === 'string' ? [selected.remotePath] : null;
  if (!Array.isArray(roots) || roots.some(path => typeof path !== 'string')) throw new Error('The original project roots are unreadable.');
  if (roots.length !== project.rootPaths.length || roots.some((path, index) => path !== project.rootPaths[index]))
    throw new Error('The original project roots changed.');
  return roots;
}

/** Capture a detached, narrow observation to submit with setMembership. */
export function captureThreadProjectMembershipExpected(state: ThreadProjectConditionState, identity: ThreadIdentity,
  source: ThreadProjectRootIdentity | null, target: ThreadProjectRootIdentity | null): ThreadProjectMembershipExpected {
  if (!identity.hostId || !identity.threadId) throw new Error('A host-qualified thread identity is required.');
  const raw = state.membershipSources.filter(item => item.hostId === identity.hostId && item.threadId === identity.threadId);
  if (raw.length !== 1) throw new Error('The original membership observation is unavailable.');
  for (const project of [source, target]) if (project) {
    if (project.hostId !== identity.hostId) throw new Error('The project and thread host must match.');
    projectRoots(state.catalog, project);
  }
  const members = state.memberships.filter(item => item.hostId === identity.hostId && item.threadId === identity.threadId);
  if (members.length > 1) throw new Error('The original thread membership is ambiguous.');
  const membership = members[0] ?? null;
  if (membership && !membership.projectless && membership.assignment &&
      (!source || source.id !== membership.assignment.projectId)) throw new Error('The original source project changed.');
  if (membership?.projectless && source) throw new Error('The thread is already projectless.');
  const unresolved = state.unresolved;
  const projectIdentity = (project: ThreadProjectRootIdentity | null) => project &&
    ({ hostId: project.hostId, id: project.id, rootPaths: [...project.rootPaths] });
  return structuredClone({ identity: { hostId: identity.hostId, threadId: identity.threadId },
    source: projectIdentity(source), target: projectIdentity(target), observed: {
    raw: raw[0]!, membership,
    unresolvedAssignment: entry(unresolved.assignments, identity.threadId),
    unresolvedProjectlessCount: unresolved.projectless.filter(value => value === identity.threadId).length,
    unreadableAssignment: entry(unresolved.unreadable, assignmentKey),
    unreadableProjectless: entry(unresolved.unreadable, projectlessKey),
    unresolvedQualified: unresolved.qualified.filter(value => value.hostId === identity.hostId &&
      (value.threadId === undefined || value.threadId === identity.threadId) &&
      (value.field === assignmentKey || value.field === projectlessKey)),
  } });
}

/** JSON-native equality ignores key order but retains unknown values and absent slots. */
export function equalThreadProjectObservation(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => equalThreadProjectObservation(value, right[index]));
  if (!object(left) || !object(right)) return false;
  const keys = Object.keys(left), other = Object.keys(right);
  return keys.length === other.length && keys.every(key => Object.hasOwn(right, key) && equalThreadProjectObservation(left[key], right[key]));
}
