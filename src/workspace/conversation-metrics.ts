import { record } from '../native/protocol.ts';

export type GoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete';
export interface ThreadGoal {
  threadId: string; objective: string; status: GoalStatus; tokenBudget: number | null;
  tokensUsed: number; timeUsedSeconds: number; createdAt: number; updatedAt: number;
}
export interface TokenUsageBreakdown {
  totalTokens: number; inputTokens: number; cachedInputTokens: number; cacheWriteInputTokens?: number;
  outputTokens: number; reasoningOutputTokens: number;
}
export interface ThreadTokenUsage {
  total: TokenUsageBreakdown; last: TokenUsageBreakdown; modelContextWindow: number | null;
}
export interface ContextUsage {
  percent: number | null; usedTokens: number | null; contextWindow: number | null; remainingTokens: number | null;
}
export interface RateLimitWindow { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null }
export interface RateLimitSnapshot {
  limitId?: string | null; limitName?: string | null; normalModelSlug?: string | null;
  primary: RateLimitWindow | null; secondary: RateLimitWindow | null;
  credits?: { hasCredits: boolean; unlimited: boolean; balance?: string | null } | null;
  planType?: string | null;
}
export interface AccountRateLimits {
  rateLimits: RateLimitSnapshot | null;
  rateLimitsByLimitId?: Record<string, RateLimitSnapshot | undefined> | null;
}

export const goalLabels: Record<GoalStatus, string> = {
  active: 'Pursuing goal', paused: 'Paused goal', blocked: 'Goal stalled',
  usageLimited: 'Goal usage limited', budgetLimited: 'Goal limited', complete: 'Goal achieved',
};

export function readThreadGoal(value: unknown): ThreadGoal | null {
  const goal = record(value);
  if (typeof goal.threadId !== 'string' || typeof goal.objective !== 'string' ||
      !Object.hasOwn(goalLabels, String(goal.status)) ||
      !['tokensUsed', 'timeUsedSeconds', 'createdAt', 'updatedAt'].every(key =>
        typeof goal[key] === 'number' && Number.isFinite(goal[key])) ||
      goal.tokenBudget != null && (typeof goal.tokenBudget !== 'number' || !Number.isFinite(goal.tokenBudget))) return null;
  return goal as unknown as ThreadGoal;
}

/** Matches the pinned renderer's otn: budget-limited goals cannot resume. */
export function nextGoalStatus(status: GoalStatus): 'active' | 'paused' | null {
  return status === 'active' ? 'paused' : ['paused', 'blocked', 'usageLimited'].includes(status) ? 'active' : null;
}

export function goalElapsedSeconds(goal: ThreadGoal, now = Date.now()) {
  return Math.max(0, goal.timeUsedSeconds + (goal.status === 'active' ? now / 1000 - goal.updatedAt : 0));
}

/** KJu/UJu use narrow units and omit zero units, including under one second. */
export function goalDuration(seconds: number, locale = 'en') {
  let rest = Math.floor(Math.max(0, seconds));
  const parts: string[] = [];
  for (const [unit, length] of [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]] as const) {
    const count = Math.floor(rest / length); rest %= length;
    if (count || !parts.length && length === 1) {
      parts.push(new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(count));
    }
  }
  return parts.join(' ');
}

/** The context window uses the latest request's tokens, never lifetime totals. */
export function contextUsage(value: ThreadTokenUsage | null | undefined): ContextUsage {
  const window = value?.modelContextWindow, used = value?.last?.totalTokens;
  if (window == null || window <= 0 || used == null || used < 0 || !Number.isFinite(window) || !Number.isFinite(used)) {
    return { percent: null, usedTokens: null, contextWindow: null, remainingTokens: null };
  }
  const usedTokens = Math.min(used, window);
  return { percent: usedTokens / window * 100, usedTokens, contextWindow: window, remainingTokens: Math.max(0, window - usedTokens) };
}

export function rateLimitLabel(minutes: number | null) {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return 'Usage remaining';
  for (const [size, singular, plural] of [[525600, 'Annual', 'Years'], [43200, 'Monthly', 'Months']] as const) {
    const count = Math.max(1, Math.round(minutes / size));
    if (minutes >= count * size * .95 && minutes <= count * size * 1.05) return count === 1 ? singular : `${count} ${plural}`;
  }
  if (minutes >= 10079) return Math.ceil(minutes / 10080) === 1 ? 'Weekly' : `${Math.ceil(minutes / 10080)} Weeks`;
  if (minutes >= 1439) return `${Math.ceil(minutes / 1440)}d`;
  return minutes >= 60 ? `${Math.ceil(minutes / 60)}h` : `${Math.ceil(minutes)}m`;
}

export function rateLimitBuckets(value: AccountRateLimits | null | undefined, selectedModel?: string | null) {
  const buckets = value?.rateLimitsByLimitId;
  const entries = buckets && Object.entries(buckets).filter((entry): entry is [string, RateLimitSnapshot] => !!entry[1]);
  const normalize = (name: string | null | undefined) => name?.trim().toLowerCase().replace(/[_\s.]+/g, '-');
  const model = normalize(selectedModel);
  const rows = entries?.length ? entries.filter(([id, bucket]) => id === 'codex' || model &&
    [bucket.normalModelSlug, bucket.limitName, id].some(name => normalize(name) === model)).map(([id, snapshot]) => ({
      id, name: id === 'codex' ? null : snapshot.limitName ?? id, snapshot,
    })) : value?.rateLimits ? [{ id: 'codex', name: null, snapshot: value.rateLimits }] : [];
  return rows.filter(({ snapshot }) => [snapshot.primary, snapshot.secondary].some(window =>
    window != null && window.windowDurationMins != null && window.windowDurationMins > 0 && Number.isFinite(window.usedPercent)));
}
