import type { WorkbenchClient } from '../../workbench-contract.ts';

export interface RecommendedSkill { id: string; name: string; description: string; repoPath: string; shortDescription?: string | null }
export interface RecommendedCatalog { skills: RecommendedSkill[]; repoRoot: string | null }

export async function readRecommendedSkills(client: WorkbenchClient, hostId: string, refresh: boolean): Promise<RecommendedCatalog> {
  const data = await client.host<{ skills?: unknown; repoRoot?: unknown; error?: unknown }>('recommended-skills', { hostId, refresh });
  if (data?.error) throw new Error(String(data.error));
  if (!Array.isArray(data?.skills) || data.repoRoot != null && typeof data.repoRoot !== 'string') throw new Error('Invalid recommended skills response');
  const skills = data.skills as RecommendedSkill[];
  if (skills.some(skill => !skill || typeof skill.id !== 'string' || typeof skill.name !== 'string'
    || typeof skill.description !== 'string' || typeof skill.repoPath !== 'string')) throw new Error('Invalid recommended skill');
  return { skills, repoRoot: data.repoRoot ?? null };
}

export async function installRecommendedSkill(client: WorkbenchClient, hostId: string, skill: RecommendedSkill, skillStatsigOverride?: unknown): Promise<void> {
  const result = await client.host<{ success?: unknown; error?: unknown }>('install-recommended-skill', {
    hostId, skillId: skill.id, repoPath: skill.repoPath, installRoot: null, skillStatsigOverride,
  });
  if (result?.success !== true) throw new Error(typeof result?.error === 'string' ? result.error : 'Skill installation was not confirmed');
}
