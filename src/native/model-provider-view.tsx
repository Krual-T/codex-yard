/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as ReactRuntime from 'react';
import { modelSelection } from './model-selection.ts';
import type { ProviderSnapshot } from './model-selection.ts';
let React: typeof ReactRuntime;
interface MenuOption { id: string; selected?: boolean }
type MenuItem = ReactRuntime.ComponentType<{
  children: ReactRuntime.ReactNode; onSelect(event: Event): void; SubText?: ReactRuntime.ReactNode;
  role?: string; 'aria-haspopup'?: boolean; 'aria-label'?: string;
}>;
interface MenuProps {
  options: MenuOption[]; Item: MenuItem; renderOption(option: MenuOption): ReactRuntime.ReactNode;
}
interface SettingsUI {
  useHost(): string;
  Row: ReactRuntime.ComponentType<{ label: ReactRuntime.ReactNode; description?: ReactRuntime.ReactNode; control: ReactRuntime.ReactNode }>;
  Toggle: ReactRuntime.ComponentType<{ checked: boolean; disabled: boolean; onChange(value: boolean): void; ariaLabel: string }>;
  Section: ReactRuntime.ComponentType<{ children: ReactRuntime.ReactNode }> & {
    Header: ReactRuntime.ComponentType<{ title: string }>;
    Content: ReactRuntime.ComponentType<{ children: ReactRuntime.ReactNode }>;
  };
}
interface QueryClient { invalidateQueries(options: { queryKey: readonly unknown[] }): unknown }
declare global { interface Window { workbenchModelProviders(params: unknown): Promise<ProviderSnapshot> } }

function ProviderOptions({ options, Item, renderOption }: MenuProps) {
  const [provider, setProvider] = React.useState<string | null>(null);
  const groups = new Map<string, MenuOption[]>();
  for (const option of options) {
    const id = modelSelection(option.id)?.provider;
    if (!id) continue;
    const group = groups.get(id) ?? []; group.push(option); groups.set(id, group);
  }
  if (!groups.size) return <>{options.map(renderOption)}</>;
  const selected = provider && groups.has(provider) ? provider : null;
  return <div data-yard-provider-menu={selected ?? ''} onKeyDown={event => {
    if (event.key === 'ArrowLeft' && selected) { event.preventDefault(); event.stopPropagation(); setProvider(null); }
  }}>
    {selected ? <>
      <Item aria-label="返回供应商" onSelect={event => { event.preventDefault(); setProvider(null); }}>‹ 供应商</Item>
      {groups.get(selected)!.map(renderOption)}
    </> : [...groups].map(([id, models]) => <Item key={id} aria-haspopup onSelect={event => { event.preventDefault(); setProvider(id); }}
      SubText={models.some(model => model.selected) ? '当前供应商' : undefined}>{id} <span aria-hidden="true">›</span></Item>)}
  </div>;
}

function ProviderSettings({ ui: { useHost, Row, Toggle, Section } }: { ui: SettingsUI }) {
  const hostId = useHost();
  const [snapshot, setSnapshot] = React.useState<ProviderSnapshot>();
  const [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
  const generation = React.useRef(0), pending = React.useRef(false);
  React.useEffect(() => {
    const revision = ++generation.current;
    setSnapshot(undefined); setError('');
    const load = () => {
      if (pending.current) return;
      void window.workbenchModelProviders({ hostId }).then(value => {
        if (revision === generation.current && !pending.current) setSnapshot(value);
      }).catch(cause => { if (revision === generation.current) setError((cause as Error).message); });
    };
    load(); window.addEventListener('focus', load);
    return () => { generation.current++; window.removeEventListener('focus', load); };
  }, [hostId]);
  async function toggle(id: string, enabled: boolean) {
    if (pending.current) return;
    const revision = generation.current;
    pending.current = true; setBusy(true); setError('');
    try {
      const value = await window.workbenchModelProviders({ operation: 'set-enabled', hostId, id, enabled });
      if (revision === generation.current) setSnapshot(value);
    } catch (cause) { if (revision === generation.current) setError((cause as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Section><Section.Header title="模型供应商" /><Section.Content>
    <div data-yard-provider-settings data-codex-character-input-boundary>
      <p className="px-4 py-2 text-sm text-secondary">读取当前主机 config.toml 中的供应商。启用后可在模型菜单中选择；关闭会隐藏目录，当前任务继续运行。</p>
      {!snapshot && !error ? <p role="status" className="px-4 py-2 text-sm">正在读取供应商…</p> : null}
      {snapshot?.providers.map(provider => <Row key={provider.id} label={provider.name}
        description={provider.error ?? (provider.id !== provider.name ? provider.id : undefined)}
        control={<Toggle checked={provider.enabled} disabled={busy} ariaLabel={'启用 ' + provider.name}
          onChange={enabled => { void toggle(provider.id, enabled); }} />} />)}
      {error ? <p role="alert" className="px-4 py-2 text-sm">{error}</p> : null}
    </div>
  </Section.Content></Section>;
}

export function installModelProviders(react: typeof ReactRuntime) {
  React = react;
  const clients = new Map<QueryClient, Map<string, readonly unknown[]>>();
  window.addEventListener('yard-model-providers-changed', () => {
    for (const [client, keys] of clients) for (const key of keys.values()) void client.invalidateQueries({ queryKey: key });
  });
  Object.assign(window, {
    workbenchModelEfforts: (model: { model: string; supportedReasoningEfforts: unknown[] }, filtered: unknown[]) =>
      modelSelection(model.model)?.model.startsWith('deepseek-') ? model.supportedReasoningEfforts : filtered,
    workbenchHasProviderOptions: (options: MenuOption[]) => options.some(option => modelSelection(option.id)),
    workbenchProviderOptions: (props: MenuProps) => react.createElement(ProviderOptions, props),
    workbenchModelProviderSettings: (ui: SettingsUI) => react.createElement(ProviderSettings, { ui }),
    workbenchWatchModels: (client: QueryClient, key: readonly unknown[]) => {
      const keys = clients.get(client) ?? new Map(); keys.set(JSON.stringify(key), key); clients.set(client, keys);
    },
  });
}
