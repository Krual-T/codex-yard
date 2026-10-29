import type { WorkbenchClient } from '../../workbench-contract.ts';

export interface LoginMethods { api: boolean; chatgpt: boolean }
export interface AccountState { authenticated: boolean }

export async function readAccount(client: WorkbenchClient, hostId: string): Promise<AccountState> {
  const result = await client.rpc<{ account?: unknown; requiresOpenaiAuth?: unknown }>('account/read', { refreshToken: false }, hostId);
  if (typeof result?.requiresOpenaiAuth !== 'boolean') throw new Error('Invalid account response');
  return { authenticated: !result.requiresOpenaiAuth || result.account != null };
}

export async function readLoginMethods(client: WorkbenchClient, hostId: string): Promise<LoginMethods> {
  const result = await client.rpc<{ requirements?: unknown }>('configRequirements/read', {}, hostId);
  if (!result || !Object.hasOwn(result, 'requirements')) throw new Error('Sign-in requirements are unavailable');
  if (result.requirements === null) {
    const config = await client.rpc<{ config?: Record<string, unknown> }>('config/read', { includeLayers: false }, hostId);
    if (!config?.config || !Object.hasOwn(config.config, 'forced_login_method')) throw new Error('Sign-in policy is unavailable from this host');
    const forced = config.config.forced_login_method;
    if (forced !== null && forced !== 'api' && forced !== 'chatgpt') throw new Error('Invalid sign-in policy');
    return { api: forced === null || forced === 'api', chatgpt: forced === null || forced === 'chatgpt' };
  }
  if (typeof result.requirements !== 'object' || Array.isArray(result.requirements)) throw new Error('Invalid sign-in requirements');
  const requirements = result.requirements as Record<string, unknown>;
  if (!Object.hasOwn(requirements, 'allowedLoginMethods')) throw new Error('This Codex version cannot report sign-in requirements');
  const methods = requirements.allowedLoginMethods;
  if (methods === null) return { api: true, chatgpt: true };
  if (!Array.isArray(methods) || methods.some(value => value !== 'api' && value !== 'chatgpt')) throw new Error('Invalid sign-in requirements');
  return { api: methods.includes('api'), chatgpt: methods.includes('chatgpt') };
}

export type LoginAttempt =
  | { type: 'apiKey' }
  | { type: 'chatgpt'; loginId: string; url: string }
  | { type: 'chatgptDeviceCode'; loginId: string; url: string; userCode: string };

function safeAuthUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid sign-in URL');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid sign-in URL'); }
  if (url.username || url.password || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Invalid sign-in URL');
  }
  return url.href;
}

export async function startLogin(client: WorkbenchClient, hostId: string, params: { type: 'chatgpt' | 'chatgptDeviceCode' } | { type: 'apiKey'; apiKey: string }): Promise<LoginAttempt> {
  const result = await client.rpc<Record<string, unknown>>('account/login/start', params, hostId);
  if (result?.type !== params.type) throw new Error('Invalid sign-in response');
  if (result.type === 'apiKey') return { type: 'apiKey' };
  if (typeof result.loginId !== 'string' || !result.loginId) throw new Error('Invalid sign-in response');
  if (result.type === 'chatgpt') return { type: 'chatgpt', loginId: result.loginId, url: safeAuthUrl(result.authUrl) };
  if (result.type === 'chatgptDeviceCode' && typeof result.userCode === 'string' && result.userCode) {
    return { type: 'chatgptDeviceCode', loginId: result.loginId, url: safeAuthUrl(result.verificationUrl), userCode: result.userCode };
  }
  throw new Error('Invalid sign-in response');
}

export async function cancelLogin(client: WorkbenchClient, hostId: string, loginId: string): Promise<'canceled' | 'notFound'> {
  const result = await client.rpc<{ status?: unknown }>('account/login/cancel', { loginId }, hostId);
  if (result?.status !== 'canceled' && result?.status !== 'notFound') throw new Error('Invalid cancellation response');
  return result.status;
}
