import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, Check, ChevronDown } from 'lucide-react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { Row } from './PreferenceControls.tsx';
import { AgentSettings } from './agent-settings.ts';
import type { AgentField } from './agent-settings.ts';
import type { ConfigReadSource } from '../../../lib/config-write-protocol.ts';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import { SettingsDraftRecovery } from './SettingsDraftRecovery.tsx';

type Feature = { name: string; stage: string; displayName: string | null; description: string | null; enabled: boolean };
const hiddenFeatures = new Set(['memories', 'multi_agent', 'plugins', 'plugin', 'remote_control', 'chronicle', 'workspace_dependencies', 'default_mode_request_user_input']);
function ExperimentalFeatures({ client, hostId }: { client: WorkbenchClient; hostId: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ loading: boolean; error: string | null; features: Feature[] }>({ loading: true, error: null, features: [] });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const read = async () => {
      setState(previous => ({ ...previous, loading: true, error: null }));
      try {
        const features: Feature[] = [], cursors = new Set<string>();
        let cursor: string | null = null;
        do {
          const page: { data: Feature[]; nextCursor?: string | null } = await client.rpc('experimentalFeature/list', { cursor, limit: 100 }, hostId);
          if (!Array.isArray(page?.data)) throw new Error('Invalid experimental features response');
          features.push(...page.data.filter(item => item && item.stage === 'beta' && typeof item.name === 'string' && typeof item.enabled === 'boolean' &&
            (item.displayName == null || typeof item.displayName === 'string') && (item.description == null || typeof item.description === 'string') &&
            !hiddenFeatures.has(item.name) && !item.name.startsWith('realtime_')));
          cursor = page.nextCursor ?? null;
          if (cursor && (cursors.has(cursor) || cursors.size >= 100)) throw new Error('Invalid experimental features pagination');
          if (cursor) cursors.add(cursor);
        } while (cursor);
        if (active) setState({ loading: false, error: null, features });
      } catch (error) { if (active) setState({ loading: false, error: error instanceof Error ? error.message : String(error), features: [] }); }
    };
    void read(); return () => { active = false; };
  }, [client, hostId, revision]);
  if (!state.loading && !state.error && !state.features.length) return null;
  return <><h3 data-setting-id="experimental" tabIndex={-1}>{t('Experimental features')}</h3>
    {state.loading ? <p>{t('Loading experimental features...')}</p> : state.error ? <p className="yard-setting-error" role="alert">{t('Could not load experimental features:')} {state.error} <button className="yard-link" type="button" onClick={() => setRevision(value => value + 1)}>{t('Retry')}</button></p> :
      state.features.length ? <><p className="yard-muted">{t('Changing experimental features is not available for this connection.')}</p><div className="yard-setting-group">
        {state.features.map(feature => <Row key={feature.name} label={feature.displayName || feature.name} description={feature.description}><span>{t(feature.enabled ? 'On' : 'Off')}</span></Row>)}
      </div></> : <p className="yard-muted">{t('No beta experimental features available.')}</p>}
  </>;
}

export function AgentSection({ client, hostId, onDirtyChange, onSavingChange, registerDiscard, onOpenConfig }: {
  client: WorkbenchClient; hostId: string; onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
  registerDiscard?: (discard: (() => Promise<boolean>) | null) => void;
  onOpenConfig?: (hostId: string, file: string, source: ConfigReadSource) => void;
}) {
  const { t } = useI18n();
  const agent = useMemo(() => new AgentSettings(client, hostId), [client, hostId]);
  const scopeMenu = useRef<HTMLDetailsElement>(null);
  const state = useSyncExternalStore(agent.subscribe, agent.getSnapshot, agent.getSnapshot), dirty = agent.dirty;
  const text = (value: string) => translateKnown(t, value);
  useEffect(() => { void agent.load(); return () => agent.dispose(); }, [agent]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const menu = scopeMenu.current;
      if (menu && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useLayoutEffect(() => { onDirtyChange(dirty || Boolean(state.draftStorageError)); }, [dirty, state.draftStorageError, onDirtyChange]);
  useLayoutEffect(() => { onSavingChange(state.saving || state.draftSaving); }, [state.saving, state.draftSaving, onSavingChange]);
  useLayoutEffect(() => { registerDiscard?.(() => agent.discard()); return () => registerDiscard?.(null); }, [agent, registerDiscard]);
  const approvalLabels: Record<string, string> = { 'on-request': text('On request'), never: text('Never ask for approval'), untrusted: text('Untrusted'), 'on-failure': text('On failure'), __advanced__: text('Advanced policy') };
  const sandboxLabels: Record<string, string> = { 'read-only': t('Read only'), 'workspace-write': t('Workspace write'), 'danger-full-access': t('Full access') };
  const fieldLabels: Record<AgentField, string> = { approval: 'Approval policy', sandbox: 'Sandbox settings', networkAccess: 'Allow network access',
    webSearch: 'Web search', verbosity: 'Output detail', reasoning: 'Reasoning summary' };
  const valueLabels: Record<AgentField, Record<string, string>> = { approval: approvalLabels, sandbox: sandboxLabels,
    networkAccess: { true: text('On'), false: text('Off') }, webSearch: { disabled: text('Disabled'), cached: text('Cached'), indexed: text('Indexed'), live: text('Live') },
    verbosity: { '': text('Model default'), low: text('Low'), medium: text('Medium'), high: text('High') },
    reasoning: { auto: text('Auto'), concise: text('Concise'), detailed: text('Detailed'), none: text('None') } };
  const disabled = (field: AgentField) => state.loading || state.saving || !state.projectionAvailable || state.locked.includes(field);
  const change = (field: AgentField, value: string) => {
    const saveImmediately = !agent.dirty;
    agent.edit(field, value);
    if (saveImmediately) void agent.save();
  };
  const select = (field: AgentField, choices: readonly string[]) => <select aria-label={text(fieldLabels[field])} value={state.values[field]}
    disabled={disabled(field) || !choices.length} onChange={event => change(field, event.target.value)}>
    {!choices.includes(state.values[field]) && <option value={state.values[field]}>{valueLabels[field][state.values[field]] ?? state.values[field]}</option>}
    {choices.map(value => <option key={value} value={value}>{valueLabels[field][value]}</option>)}
  </select>;
  const description = (field: AgentField, detail: string) => state.locked.includes(field) && state.projectionAvailable
    ? <>{text(detail)} {' '}{text('Managed by admin policy.')}</> : detail;
  return <>
    <div className="yard-section-heading"><h3 style={{ fontWeight: 500 }}>{text('Agent defaults')}</h3></div>
    <div className="yard-section-heading">
      <details className="yard-config-scope" ref={scopeMenu} onKeyDown={event => {
        const menu = scopeMenu.current, summary = menu?.querySelector('summary');
        if (!menu || !summary) return;
        if (event.key === 'Escape' && menu.open) { event.preventDefault(); event.stopPropagation(); menu.open = false; summary.focus(); }
        else if (event.key === 'ArrowDown' && event.target === summary) {
          event.preventDefault(); menu.open = true; menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
        }
      }}>
        <summary role="button" aria-haspopup="menu" aria-label={text('User config')}>{text('User config')}<ChevronDown size={12} aria-hidden="true" /></summary>
        <div role="menu" aria-label={text('User config')}>
          <span className="yard-config-scope-label">{t('Global config')}</span>
          <button type="button" role="menuitem" onClick={() => {
            const menu = scopeMenu.current; if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); }
          }}>{text('User config')}<Check size={14} aria-hidden="true" /></button>
        </div>
      </details>
      <button type="button" className="yard-config-open" disabled={!onOpenConfig || !state.configFile || state.loading || state.saving}
        onClick={() => { const target = agent.getOpenConfigTarget(); if (onOpenConfig && target) onOpenConfig(target.hostId, target.file, target.source); }}>
        {text('Open config.toml')}<ArrowUpRight size={12} aria-hidden="true" />
      </button>
    </div>
    <SettingsDraftRecovery client={client} hostId={hostId} section="agent" editorId={agent.editorId}
      disabled={dirty || state.loading || state.saving || state.draftSaving} onRestore={draft => agent.restoreDraft(draft)} />
    {state.error && <p className="yard-setting-error" role="alert">{translateKnown(t, state.error)} <button type="button" className="yard-link" disabled={state.loading || state.saving} onClick={() => { void agent.load(); }}>{t('Reload')}</button></p>}
    {state.writeError && <p className="yard-setting-error" role="alert">{state.writeError} <button type="button" className="yard-link" disabled={state.loading || state.saving} onClick={() => { void agent.load(true); }}>Reload and review</button></p>}
    {state.draftStorageError && <p className="yard-setting-error" role="alert">Could not save the newer edit in this browser: {state.draftStorageError}{' '}
      <button type="button" onClick={() => { void agent.retryDraftPersistence(); }}>Retry saving edit</button></p>}
    {state.warning && <p role="status">{state.warning}</p>}
    {state.conflicts.map(field => {
      const labels = valueLabels[field];
      return <div key={field} className="yard-setting-error" role="alert">
        <p>{text(fieldLabels[field])} {t('changed elsewhere.')} {t('Current:')} {labels[state.saved[field]] ?? state.saved[field]}; {t('Your edit:')} {labels[state.values[field]] ?? state.values[field]}.</p>
        <div className="yard-actions"><button type="button" disabled={state.saving} onClick={() => agent.resolveConflict(field, 'current')}>{t('Use current value')}</button>
          <button type="button" disabled={state.saving} onClick={() => agent.resolveConflict(field, 'draft')}>{t('Keep my change')}</button></div>
      </div>;
    })}
    {state.loading ? <p>{t('Loading agent settings...')}</p> : <div className="yard-setting-group">
      <Row label="Approval policy" description={description('approval', 'Choose when ChatGPT asks for approval')}>
        {select('approval', state.approvals)}
      </Row>
      <Row label="Sandbox settings" description={description('sandbox', 'Choose how much ChatGPT can do when running commands')}>
        {select('sandbox', state.sandboxes)}
      </Row>
      {state.values.sandbox === 'workspace-write' && <Row label="Allow network access" description={description('networkAccess', 'Allow network access while commands run in the workspace')}>
        <input type="checkbox" role="switch" aria-label={text('Allow network access')} checked={state.values.networkAccess === 'true'}
          disabled={disabled('networkAccess') || state.values.networkAccess === '__advanced__'} onChange={event => change('networkAccess', String(event.target.checked))} />
      </Row>}
      <Row label="Web search" description={description('webSearch', 'Choose how ChatGPT accesses the web')}>{select('webSearch', state.webSearches)}</Row>
      <Row label="Output detail" description={description('verbosity', 'Choose how much detail ChatGPT includes in responses')}>{select('verbosity', ['', 'low', 'medium', 'high'])}</Row>
      <Row label="Reasoning summary" description={description('reasoning', 'Choose how ChatGPT summarizes its reasoning')}>{select('reasoning', ['auto', 'concise', 'detailed', 'none'])}</Row>
    </div>}
    {dirty && <div className="yard-inline-save"><span>{t('Unsaved agent settings')}</span><div className="yard-actions">
      <button type="button" disabled={state.saving} onClick={() => { void agent.discard(); }}>{t('Discard')}</button>
      <button type="button" disabled={state.saving || Boolean(state.writeError) || state.conflicts.length > 0} onClick={() => { void agent.save(); }}>{t(state.saving ? 'Saving...' : 'Save')}</button>
    </div></div>}
    <ExperimentalFeatures client={client} hostId={hostId} />
  </>;
}
