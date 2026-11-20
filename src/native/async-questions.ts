import type { ThreadItemSummary } from '../../lib/codex-protocol.ts';
import { record } from './protocol.ts';

export type AsyncQuestion = { id: string; title: string; options: string[] };
export type QuestionReply = { questionItemId: string; question: string; answer: string };
const opening = '<send_user_message_question_reply>';
const closing = '</send_user_message_question_reply>';

/** IDs and reply envelope match the pinned request_user_input_async client. */
export function asyncQuestions(item: ThreadItemSummary): AsyncQuestion[] {
  if (item.type !== 'agentMessage' || !Array.isArray(item.questions)) return [];
  return item.questions.flatMap((value, index) => {
    const question = record(value);
    if (typeof question.title !== 'string' || !question.title.trim()) return [];
    return [{ id: JSON.stringify(['request_user_input_async', item.id, index]), title: question.title,
      options: Array.isArray(question.options) ? question.options.filter((option): option is string => typeof option === 'string') : [] }];
  });
}

export function questionReplies(item: ThreadItemSummary): QuestionReply[] {
  if (item.type !== 'userMessage' && (item.type !== 'steeringUserMessage' || item.status !== 'accepted')) return [];
  const content = item.type === 'userMessage' ? item.content : item.input;
  if (!Array.isArray(content) || content.length !== 1) return [];
  const part = record(content[0]);
  if (part.type !== 'text' || typeof part.text !== 'string') return [];
  const text = part.text.trim();
  if (!text.startsWith(opening) || !text.endsWith(closing)) return [];
  try {
    const parsed: unknown = JSON.parse(text.slice(opening.length, -closing.length));
    const values = Array.isArray(parsed) ? parsed : [parsed];
    if (!values.length) return [];
    return values.map(record).every(value => typeof value.questionItemId === 'string' &&
      typeof value.question === 'string' && typeof value.answer === 'string') ? values as QuestionReply[] : [];
  } catch { return []; }
}

export function questionReplyText(replies: readonly QuestionReply[]) {
  return opening + '\n' + JSON.stringify(replies) + '\n' + closing;
}
