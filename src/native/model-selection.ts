/** Provider-qualified identities exist only at the Yard renderer boundary.
 * Codex and provider APIs always receive the original model name. */
export interface ModelSelection { provider: string; model: string }
const prefix = 'yard-model:';
export function modelIdentity(provider: string, model: string): string {
  return prefix + encodeURIComponent(provider) + '/' + encodeURIComponent(model);
}
export function modelSelection(value: unknown): ModelSelection | null {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
  const parts = value.slice(prefix.length).split('/');
  if (parts.length !== 2) throw new Error('模型标识无效');
  try {
    const [provider, model] = parts.map(decodeURIComponent);
    if (!provider || !model) throw new Error();
    return { provider, model };
  } catch { throw new Error('模型标识无效'); }
}

export interface ProviderSummary { id: string; name: string; enabled: boolean; error?: string }
export interface ProviderSnapshot { providers: ProviderSummary[] }
