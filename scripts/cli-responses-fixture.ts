import { createServer } from 'node:http';

/** The scripted loopback Responses fixture shared by standalone CLI checks. */
export async function createCliResponsesFixture(reply: (body: string) => {
  text: string; commentary?: string; wait?: Promise<void>; split?: { offset: number; wait: Promise<void> };
} | { tool: { name: string; namespace?: string; callId: string; arguments: string }; wait?: Promise<void> }
  | { toolCall: { name: string; namespace?: string; arguments: object }; wait?: Promise<void> }) {
  let requests = 0;
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    if (!request.url?.endsWith('/responses')) { response.writeHead(404).end('{}'); return; }
    requests++;
    const result = reply(body), id = 'fixture-' + crypto.randomUUID();
    const next = 'toolCall' in result ? { tool: { ...result.toolCall, callId: 'call-' + id,
      arguments: JSON.stringify(result.toolCall.arguments) }, wait: result.wait } : result;
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const event = (type: string, value: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    event('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
    const output: object[] = [];
    let outputIndex = 0;
    function finish(item: object) {
      event('response.output_item.done', { output_index: outputIndex, item });
      event('response.completed', { response: { id, object: 'response', status: 'completed', output: [...output, item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 } } } });
      response.end();
    }
    if ('tool' in next) {
      if (next.wait) await next.wait;
      if (response.destroyed) return;
      const { callId, ...tool } = next.tool;
      const item = { ...tool, type: 'function_call', id: 'function-' + id, call_id: callId, status: 'completed' };
      event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', arguments: '' } });
      event('response.function_call_arguments.delta', { output_index: 0, item_id: item.id, delta: item.arguments });
      event('response.function_call_arguments.done', { output_index: 0, item_id: item.id, arguments: item.arguments });
      finish(item);
      return;
    }
    const { text, commentary, wait, split } = next;
    if (commentary) {
      const progress = { id: 'progress-' + id, type: 'message', role: 'assistant', phase: 'commentary', status: 'completed',
        content: [{ type: 'output_text', text: commentary, annotations: [] }] };
      event('response.output_item.added', { output_index: 0, item: { ...progress, status: 'in_progress', content: [] } });
      event('response.content_part.added', { output_index: 0, item_id: progress.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      event('response.output_text.delta', { output_index: 0, item_id: progress.id, content_index: 0, delta: commentary });
      event('response.output_item.done', { output_index: 0, item: progress });
      output.push(progress);
      outputIndex++;
    }
    const item = { id: 'message-' + id, type: 'message', role: 'assistant', phase: 'final_answer', status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }] };
    if (wait) await wait;
    if (response.destroyed) return;
    event('response.output_item.added', { output_index: outputIndex, item: { ...item, status: 'in_progress', content: [] } });
    event('response.content_part.added', { output_index: outputIndex, item_id: item.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    function delta(value: string) {
      event('response.output_text.delta', { output_index: outputIndex, item_id: item.id, content_index: 0, delta: value });
    }
    if (split) {
      delta(text.slice(0, split.offset));
      await split.wait;
      if (response.destroyed) return;
      delta(text.slice(split.offset));
    } else delta(text);
    finish(item);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as import('node:net').AddressInfo).port, get requests() { return requests; } };
}
