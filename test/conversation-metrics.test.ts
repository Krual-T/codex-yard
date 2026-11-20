import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextUsage, goalDuration, goalElapsedSeconds, nextGoalStatus, rateLimitBuckets, rateLimitLabel,
  readThreadGoal, type ThreadGoal, type ThreadTokenUsage } from '../src/workspace/conversation-metrics.ts';

const goal: ThreadGoal = { threadId: 'fixture', objective: 'Finish the fixture', status: 'active', tokenBudget: 100_000,
  tokensUsed: 12_500, timeUsedSeconds: 70, createdAt: 100, updatedAt: 200 };

test('goal status transitions preserve daemon budget and completion states', () => {
  assert.equal(nextGoalStatus('active'), 'paused');
  for (const state of ['paused', 'blocked', 'usageLimited'] as const) assert.equal(nextGoalStatus(state), 'active');
  for (const state of ['budgetLimited', 'complete'] as const) assert.equal(nextGoalStatus(state), null);
  assert.equal(goalElapsedSeconds(goal, 205_500), 75.5);
  assert.equal(goalElapsedSeconds({ ...goal, status: 'paused' }, 205_500), 70);
  assert.equal(goalElapsedSeconds(goal, 0), 0);
  assert.equal(goalDuration(90_061), '1d 1h 1m 1s');
  assert.equal(goalDuration(.4), '0s');
  assert.deepEqual(readThreadGoal(goal), goal);
  assert.equal(readThreadGoal({ ...goal, status: 'unknown' }), null);
  assert.equal(readThreadGoal({ ...goal, tokensUsed: NaN }), null);
});

test('context usage follows the last request, bounds overflow, and hides unavailable data', () => {
  const usage = { last: { totalTokens: 20_000 }, total: { totalTokens: 900_000 }, modelContextWindow: 200_000 } as ThreadTokenUsage;
  assert.deepEqual(contextUsage(usage), { percent: 10, usedTokens: 20_000, contextWindow: 200_000, remainingTokens: 180_000 });
  assert.deepEqual(contextUsage({ ...usage, last: { ...usage.last, totalTokens: 300_000 } }), {
    percent: 100, usedTokens: 200_000, contextWindow: 200_000, remainingTokens: 0,
  });
  for (const value of [null, { ...usage, modelContextWindow: 0 }, { ...usage, last: { ...usage.last, totalTokens: -1 } }]) {
    assert.equal(contextUsage(value).percent, null);
  }
});

test('quota rows retain the general bucket and only the selected model bucket', () => {
  const snapshot = { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 400 }, secondary: null };
  const limits = { rateLimits: snapshot, rateLimitsByLimitId: {
    codex: snapshot, 'gpt-5.5': { ...snapshot, limitName: 'GPT_5.5', normalModelSlug: 'gpt-5.5' },
    'other-model': { ...snapshot, limitName: 'Other model' },
  } };
  assert.deepEqual(rateLimitBuckets(limits).map(row => row.id), ['codex']);
  assert.deepEqual(rateLimitBuckets(limits, 'GPT_5.5').map(row => row.id), ['codex', 'gpt-5.5']);
  assert.equal(rateLimitBuckets(null).length, 0);
  assert.equal(rateLimitLabel(300), '5h');
  assert.equal(rateLimitLabel(10080), 'Weekly');
  assert.equal(rateLimitLabel(43200), 'Monthly');
  assert.equal(rateLimitLabel(525600), 'Annual');
});
