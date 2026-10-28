import type { ServerRequestRef } from '../workbench-contract.ts';
import type { ApprovalInputDraft } from '../app/ApprovalDialog.tsx';
import type { ApprovalRequestState, ApprovalRequestsController } from '../app/approval-requests.ts';
import { questionsFrom } from '../app/approval-questions.ts';

interface MiniRequestView {
  requestRef: ServerRequestRef;
  title: string;
  detail?: string;
  outcome: 'ready' | 'sending' | 'sent' | 'unknown' | 'expired';
  error?: string;
}
export type MiniApprovalRequest =
  | { kind: 'approval'; request: MiniRequestView & { choices: readonly { label: string; result: unknown }[] } }
  | { kind: 'question'; request: MiniRequestView & { inputDraft: ApprovalInputDraft; questions: readonly {
    id: string; header: string; question: string; isOther: boolean; isSecret: boolean;
    options: readonly { label: string; description: string }[] | null;
  }[] } }
  | { kind: 'open'; request: MiniRequestView };

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const sameRef = (a: ServerRequestRef, b: ServerRequestRef) =>
  a.hostId === b.hostId && a.id === b.id && a.generation === b.generation;
const only = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const visible = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu, character => {
  if (character === ' ') return character;
  const point = character.codePointAt(0)!;
  return point <= 0xffff ? '\\u' + point.toString(16).toUpperCase().padStart(4, '0') : '\\u{' + point.toString(16).toUpperCase() + '}';
});

/** This shape is assignable to the MiniRequest exported by Mini's 22517889 source. */
export function projectMiniApproval(entry: ApprovalRequestState): MiniApprovalRequest {
  const { request } = entry;
  const base: MiniRequestView = { requestRef: request.ref, title: 'Approval request', outcome: entry.outcome,
    ...(entry.error ? { error: entry.error } : {}) };
  const params = request.params;
  if (request.method === 'item/tool/requestUserInput' && only(params, ['threadId', 'turnId', 'itemId', 'questions', 'isBlocking'])) {
    const questions = questionsFrom(params.questions);
    if (questions?.length === 1 && (params.isBlocking == null || typeof params.isBlocking === 'boolean')
      && Array.isArray(params.questions) && params.questions.every(item => object(item)
      && only(item, ['id', 'header', 'question', 'isSecret', 'isOther', 'options'])
      && Array.isArray(item.options) && item.options.length > 0 && item.options.every((option: unknown) => object(option)
        && only(option, ['label', 'description'])))
      && questions.every(item => !item.isSecret && !item.isOther && !['__proto__', 'constructor', 'prototype'].includes(item.id)
        && item.options?.length && item.options.every(option => option.label === option.label.trim()))) {
      return { kind: 'question', request: { ...base, title: 'Input requested', inputDraft: entry.inputDraft,
        questions: questions.map(item => ({ id: item.id, header: item.header ?? '', question: item.question,
          isSecret: false, isOther: false, options: item.options!.map(option => ({ label: option.label, description: option.description ?? '' })) })) } };
    }
  }
  if (request.method === 'item/commandExecution/requestApproval'
    && only(params, ['threadId', 'turnId', 'itemId', 'command', 'cwd', 'reason', 'availableDecisions'])
    && typeof params.command === 'string' && params.command.trim() && typeof params.cwd === 'string' && params.cwd.trim()
    && (params.reason == null || typeof params.reason === 'string') && Array.isArray(params.availableDecisions)
    && params.availableDecisions.length > 0 && new Set(params.availableDecisions).size === params.availableDecisions.length
    && params.availableDecisions.every(decision => ['accept', 'acceptForSession', 'decline', 'cancel'].includes(decision))) {
    const labels: Record<string, string> = { accept: 'Approve', acceptForSession: 'Approve for session', decline: 'Decline', cancel: 'Cancel' };
    const detail = `Command: ${visible(params.command)}\nDirectory: ${visible(params.cwd)}`
      + (typeof params.reason === 'string' && params.reason ? `\nReason: ${visible(params.reason)}` : '');
    return { kind: 'approval', request: { ...base, title: 'Command approval', detail,
      choices: params.availableDecisions.map(decision => ({ label: labels[decision]!, result: { decision } })) } };
  }
  return { kind: 'open', request: { ...base, title: request.method === 'item/tool/requestUserInput' ? 'Input requested' : base.title,
    detail: 'Open the conversation to review this request.' } };
}

export function miniApprovalRequests(controller: ApprovalRequestsController, hostId: string, threadId: string): MiniApprovalRequest[] {
  return controller.getSnapshot().filter(entry => entry.request.hostId === hostId && entry.request.params.threadId === threadId)
    .map(projectMiniApproval);
}

export function miniPendingApprovalRefs(controller: ApprovalRequestsController): ServerRequestRef[] {
  return controller.getSnapshot().filter(entry => entry.current && entry.outcome === 'ready').map(entry => entry.request.ref);
}

function find(controller: ApprovalRequestsController, ref: ServerRequestRef) {
  return controller.getSnapshot().find(entry => sameRef(entry.request.ref, ref));
}

/** Reject responses that the compact view did not actually offer. */
export async function respondFromMini(controller: ApprovalRequestsController, ref: ServerRequestRef, result: unknown): Promise<void> {
  const entry = find(controller, ref);
  if (!entry?.current || entry.outcome !== 'ready') throw new Error('The original approval request is no longer available.');
  const projected = projectMiniApproval(entry);
  let allowed = false;
  if (projected.kind === 'approval') {
    allowed = projected.request.choices.some(choice => JSON.stringify(choice.result) === JSON.stringify(result));
  } else if (projected.kind === 'question') {
    const answers = Object.fromEntries(projected.request.questions.map(question => {
      const answer = Object.hasOwn(entry.inputDraft, question.id) ? entry.inputDraft[question.id] : undefined;
      const selected = answer?.selected ?? question.options?.[0]?.label;
      return [question.id, { answers: [selected] }];
    }));
    allowed = projected.request.questions.every(question => {
      const answer = Object.hasOwn(entry.inputDraft, question.id) ? entry.inputDraft[question.id] : undefined;
      const selected = answer?.selected ?? question.options?.[0]?.label;
      return question.options?.some(option => option.label === selected);
    }) && JSON.stringify({ answers }) === JSON.stringify(result);
  }
  if (!allowed) throw new Error('This response requires review in the original conversation.');
  await controller.respond(ref, result);
}

export function updateMiniApprovalDraft(controller: ApprovalRequestsController, ref: ServerRequestRef, draft: ApprovalInputDraft): void {
  const entry = find(controller, ref);
  if (!entry?.current || entry.outcome !== 'ready') return;
  const projected = projectMiniApproval(entry);
  if (projected.kind !== 'question') return;
  for (const [id, answer] of Object.entries(draft)) {
    const question = projected.request.questions.find(item => item.id === id);
    if (!question || !answer || typeof answer.other !== 'string' || typeof answer.selected !== 'string'
      || !question.options?.some(option => option.label === answer.selected)) return;
  }
  const question = projected.request.questions[0]!;
  const answer = Object.hasOwn(draft, question.id) ? draft[question.id] : undefined;
  if (answer) controller.updateInputAnswer(ref, question.id, answer);
}
