/** The public configuration transport used by the pinned renderer's httpFetch RPC. */
export interface HttpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  keepalive?: boolean;
  returnErrorResponse?: boolean;
}

export interface HttpWireRequest extends Omit<HttpRequest, 'body'> {
  body?: string | number[];
}

export interface HttpFailure {
  error: string;
  status: number;
  responseStatus: null;
  errorKind: 'network';
}

// These endpoints use the renderer's public Statsig client key. They require no
// Codex token; the desktop host explicitly excludes ab.chatgpt.com from auth.
export function configurationRequest(value: HttpWireRequest): { url: URL; init: RequestInit } {
  const url = new URL(value.url, 'https://chatgpt.com');
  const paths: Record<string, string[]> = {
    'https://ab.chatgpt.com': ['/v1/initialize', '/v1/sdk_exception'],
    'https://chatgpt.com': ['/ces/v1/rgstr'],
  };
  if (url.username || url.password || !paths[url.origin]?.includes(url.pathname) || value.method !== 'POST') {
    throw new Error('当前 HTTP 宿主支持原版功能配置与事件端点');
  }
  const headers = new Headers();
  for (const [name, content] of Object.entries(value.headers ?? {})) {
    if (/^(content-type|content-encoding|statsig-.+)$/i.test(name)) headers.set(name, content);
  }
  if (value.body != null && typeof value.body !== 'string' &&
      (!Array.isArray(value.body) || !value.body.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255))) {
    throw new Error('无效 HTTP 请求正文');
  }
  return { url, init: { method: value.method, headers,
    body: Array.isArray(value.body) ? new Uint8Array(value.body) : value.body,
    redirect: 'error',
  } };
}

export function httpFailure(error: unknown): HttpFailure {
  const cause = error instanceof Error ? error.cause as { code?: string } | undefined : undefined;
  return { error: error instanceof Error ? error.message + (cause?.code ? ` (${cause.code})` : '') : 'HTTP 请求失败',
    status: 502, responseStatus: null, errorKind: 'network' };
}
