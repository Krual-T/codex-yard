import type { HttpRequest, HttpWireRequest, HttpFailure } from './http-fetch.ts';

/** Keep cancellation alive until the RPC consumer finishes reading the body. */
export class BrowserHttpFetch {
  private readonly requests = new Map<string, AbortController>();

  async fetch(id: string, request: HttpRequest): Promise<{ response: Response } | HttpFailure> {
    const controller = new AbortController();
    this.requests.set(id, controller);
    const finish = () => this.requests.delete(id);
    const wire: HttpWireRequest = { ...request, body: request.body instanceof Uint8Array ? Array.from(request.body) : request.body };
    try {
      const response = await fetch('/api/http-fetch', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wire), signal: controller.signal });
      if (response.headers.get('X-Workbench-Fetch-Error') === '1') {
        finish();
        return await response.json() as HttpFailure;
      }
      // The renderer instruments fetch and can expose an empty stream even for
      // a null-body status. Response's constructor requires an actual null here.
      if ([204, 205, 304].includes(response.status)) {
        await response.body?.cancel();
        finish();
        return { response: new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers }) };
      }
      if (!response.body) { finish(); return { response }; }
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(target) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { finish(); target.close(); }
            else target.enqueue(chunk.value);
          } catch (error) { finish(); target.error(error); }
        },
        async cancel(reason) { controller.abort(reason); finish(); await reader.cancel(reason); },
      });
      return { response: new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }) };
    } catch (error) {
      finish();
      throw error;
    }
  }

  cancel(id: string) { this.requests.get(id)?.abort(); this.requests.delete(id); }
}
