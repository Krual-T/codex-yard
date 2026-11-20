import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asyncQuestions, questionReplies, questionReplyText } from '../src/native/async-questions.ts';

test('async questions retain the original composite IDs and optional freeform choices', () => {
  assert.deepEqual(asyncQuestions({ id: 'call-one', type: 'agentMessage', delivery: 'async', questions: [
    { title: 'Continue?', options: ['Yes', 'Wait'] }, { title: 'Any constraints?' },
  ] }), [
    { id: '["request_user_input_async","call-one",0]', title: 'Continue?', options: ['Yes', 'Wait'] },
    { id: '["request_user_input_async","call-one",1]', title: 'Any constraints?', options: [] },
  ]);
});

test('the original reply envelope survives history and accepted steering without exposing protocol tags', () => {
  const replies = [{ questionItemId: '["request_user_input_async","call-one",0]', question: 'Continue?', answer: 'Yes' }];
  const text = questionReplyText(replies);
  const content = [{ type: 'text', text }];
  assert.deepEqual(questionReplies({ id: 'reply', type: 'userMessage', content }), replies);
  assert.deepEqual(questionReplies({ id: 'reply', type: 'steeringUserMessage', status: 'accepted', input: content }), replies);
  assert.deepEqual(questionReplies({ id: 'reply', type: 'steeringUserMessage', status: 'pending', input: content }), []);
  assert.deepEqual(questionReplies({ id: 'reply', type: 'userMessage', content: [{ type: 'text', text:
    '<send_user_message_question_reply>' + JSON.stringify(replies[0]) + '</send_user_message_question_reply>' }] }), replies);
  assert.deepEqual(questionReplies({ id: 'reply', type: 'userMessage', content: [{ type: 'text', text: 'Ordinary text' }] }), []);
  assert.deepEqual(questionReplies({ id: 'reply', type: 'userMessage', content: [{ type: 'text', text:
    '<send_user_message_question_reply>invalid</send_user_message_question_reply>' }] }), []);
});
