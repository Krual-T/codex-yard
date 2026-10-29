import type { WorkbenchClient } from '../../workbench-contract.ts';

export interface Skill {
  name: string;
  description: string;
  path: string;
  scope: string;
  enabled: boolean;
  shortDescription?: string | null;
  pluginId?: string | null;
  interface?: { displayName?: string | null; shortDescription?: string | null } | null;
}

export interface SkillGroup { cwd: string; skills: Skill[]; errors: { path: string; message: string }[] }
export interface SkillChangeScope { hostId: string; cwd: string }
export type SkillChange = SkillChangeScope & (
  | { kind: 'setEnabled'; path: string; name: string; enabled: boolean }
  | { kind: 'remove'; path: string }
  | { kind: 'installRecommended'; skillId: string; repoPath: string; installRoot: null }
);

export function skillDisplayName(skill: Skill): string { return skill.interface?.displayName || skill.name; }

export async function listSkills(client: WorkbenchClient, hostId: string, cwd: string, forceReload = false): Promise<SkillGroup[]> {
  const response = await client.rpc<{ data?: unknown }>('skills/list', { cwds: cwd ? [cwd] : [], forceReload }, hostId);
  if (!Array.isArray(response?.data)) throw new Error('Invalid skills response');
  return response.data.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid skills response');
    const group = value as Partial<SkillGroup>;
    if (typeof group.cwd !== 'string' || !Array.isArray(group.skills) || !Array.isArray(group.errors)) throw new Error('Invalid skills response');
    for (const skill of group.skills) {
      if (!skill || typeof skill.name !== 'string' || typeof skill.path !== 'string' || typeof skill.description !== 'string'
        || typeof skill.scope !== 'string' || typeof skill.enabled !== 'boolean') throw new Error('Invalid skill in response');
    }
    for (const error of group.errors) {
      if (!error || typeof error.path !== 'string' || typeof error.message !== 'string') throw new Error('Invalid skill error in response');
    }
    return group as SkillGroup;
  });
}

export async function setSkillEnabled(client: WorkbenchClient, hostId: string, skill: Skill, enabled: boolean): Promise<boolean> {
  const selector = skill.name.includes(':') ? { name: skill.name } : { path: skill.path };
  const response = await client.rpc<{ effectiveEnabled?: unknown }>('skills/config/write', { ...selector, enabled }, hostId);
  if (typeof response?.effectiveEnabled !== 'boolean') throw new Error('Invalid skill update response');
  return response.effectiveEnabled;
}

export async function readSkill(client: WorkbenchClient, hostId: string, path: string): Promise<string> {
  const response = await client.host<{ contents?: unknown }>('read-file', { hostId, path });
  if (typeof response?.contents !== 'string') throw new Error('Invalid file response');
  return response.contents;
}

export async function removeSkill(client: WorkbenchClient, hostId: string, skillPath: string): Promise<void> {
  const response = await client.host<{ success?: unknown }>('remove-skill', { hostId, skillPath });
  if (response?.success !== true) throw new Error('Skill removal was not confirmed');
}
