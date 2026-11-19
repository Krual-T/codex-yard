import { createServer } from 'node:http';

/** The scripted loopback Responses fixture shared by standalone CLI checks. */
export async function createCliResponsesFixture(reply: (body: string) =>
  ({ text: string } | { toolCall: { name: string; namespace?: string; arguments: object } }) & { wait?: Promise<void> }) {
  let requests = 0;
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    if (!request.url?.endsWith('/responses')) { response.writeHead(404).end('{}'); return; }
    requests++;
    const result = reply(body), id = 'fixture-' + crypto.randomUUID();
    const item = 'toolCall' in result
      ? { id: 'function-' + id, type: 'function_call' as const, call_id: 'call-' + id, name: result.toolCall.name,
        ...(result.toolCall.namespace ? { namespace: result.toolCall.namespace } : {}),
        arguments: JSON.stringify(result.toolCall.arguments), status: 'completed' }
      : { id: 'message-' + id, type: 'message' as const, role: 'assistant', phase: 'final_answer', status: 'completed',
        content: [{ type: 'output_text', text: result.text, annotations: [] }] };
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const event = (type: string, value: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    event('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
    if (result.wait) await result.wait;
    if (response.destroyed) return;
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress',
      ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } });
    if (item.type === 'function_call') {
      event('response.function_call_arguments.delta', { output_index: 0, item_id: item.id, delta: item.arguments });
      event('response.function_call_arguments.done', { output_index: 0, item_id: item.id, arguments: item.arguments });
    } else if ('text' in result) {
      event('response.content_part.added', { output_index: 0, item_id: item.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      event('response.output_text.delta', { output_index: 0, item_id: item.id, content_index: 0, delta: result.text });
    }
    event('response.output_item.done', { output_index: 0, item });
    event('response.completed', { response: { id, object: 'response', status: 'completed', output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 } } } });
    response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as import('node:net').AddressInfo).port, get requests() { return requests; } };
}
