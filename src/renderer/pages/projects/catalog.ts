export type ProjectKind = 'local' | 'remote' | 'cloud';

export interface ProjectEntry {
  id: string;
  kind: ProjectKind;
  hostId: string;
  name: string;
  location: string | null;
  updatedAt: number | null;
  pinned: boolean | null;
  canEdit: boolean;
  canRemove: boolean;
  canArchive: boolean;
  canCreateChat: boolean;
}

export interface ProjectChat {
  id: string;
  hostId: string;
  origin: 'local' | 'cloud';
  title: string;
  updatedAt: number | null;
}

export interface ProjectPage<T> {
  items: T[];
  nextCursor: string | null;
  warnings: { source: string; message: string }[];
}

export interface ProjectScope {
  hostId: string;
  accountKey: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function timestamp(value: unknown): value is number | null {
  return value === null || typeof value === 'number' && Number.isFinite(value);
}

export function projectKey(project: ProjectEntry) {
  return JSON.stringify([project.kind, project.hostId, project.id]);
}

export function chatKey(chat: ProjectChat) {
  return JSON.stringify([chat.origin, chat.hostId, chat.id]);
}

export function projectPage(value: unknown): ProjectPage<ProjectEntry> {
  const page = checkedPage(value);
  for (const item of page.items) {
    if (!record(item) || typeof item.id !== 'string' || !item.id.trim() || typeof item.hostId !== 'string' || !item.hostId.trim() ||
      typeof item.kind !== 'string' || !['local', 'remote', 'cloud'].includes(item.kind) || typeof item.name !== 'string' ||
      !(item.location === null || typeof item.location === 'string') || !timestamp(item.updatedAt) ||
      !(item.pinned === null || typeof item.pinned === 'boolean') || typeof item.canEdit !== 'boolean' ||
      typeof item.canRemove !== 'boolean' || typeof item.canArchive !== 'boolean' || typeof item.canCreateChat !== 'boolean') {
      throw new Error('Invalid project');
    }
  }
  return page as ProjectPage<ProjectEntry>;
}

export function projectChatPage(value: unknown): ProjectPage<ProjectChat> {
  const page = checkedPage(value);
  for (const item of page.items) {
    if (!record(item) || typeof item.id !== 'string' || !item.id.trim() || typeof item.hostId !== 'string' || !item.hostId.trim() ||
      typeof item.origin !== 'string' || !['local', 'cloud'].includes(item.origin) || typeof item.title !== 'string' || !timestamp(item.updatedAt)) throw new Error('Invalid project chat');
  }
  return page as ProjectPage<ProjectChat>;
}

function checkedPage(value: unknown): ProjectPage<unknown> {
  if (!record(value) || !Array.isArray(value.items) || !(value.nextCursor === null || typeof value.nextCursor === 'string' && !!value.nextCursor) ||
    !Array.isArray(value.warnings) || value.warnings.some(warning => !record(warning) || typeof warning.source !== 'string' ||
      !warning.source.trim() || typeof warning.message !== 'string' || !warning.message.trim())) throw new Error('Invalid project page');
  return value as unknown as ProjectPage<unknown>;
}
