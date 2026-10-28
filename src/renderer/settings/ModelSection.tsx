import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { Row } from './PreferenceControls.tsx';
import { ModelSettings } from './model-settings.ts';

export function ModelSection({ client, hostId, onDirtyChange, onSavingChange }: {
  client: WorkbenchClient; hostId: string; onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
}) {
  const modelSettings = useMemo(() => new ModelSettings(client, hostId), [client, hostId]);
  const state = useSyncExternalStore(modelSettings.subscribe, modelSettings.getSnapshot, modelSettings.getSnapshot);
  const dirty = modelSettings.dirty;
  useEffect(() => { void modelSettings.load(); return () => modelSettings.dispose(); }, [modelSettings]);
  useLayoutEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => { onSavingChange(state.saving); }, [state.saving, onSavingChange]);
  const selected = state.models.find(model => model.model === state.model);
  const efforts = Array.isArray(selected?.supportedReasoningEfforts) ? selected.supportedReasoningEfforts : [];
  return <>
    <div className="yard-section-heading"><h2>Models</h2><button type="button" disabled={dirty || state.loading || state.saving} onClick={() => { void modelSettings.load(); }}>Refresh</button></div>
    <p className="yard-muted">Default model and reasoning effort for {hostId === 'local' ? 'the local host' : hostId}.</p>
    {state.error && <p className="yard-setting-error" role="alert">{state.error} <button type="button" className="yard-link" disabled={state.loading || state.saving} onClick={() => { void modelSettings.load(); }}>Reload</button></p>}
    {state.writeError && <p className="yard-setting-error" role="alert">{state.writeError} <button type="button" className="yard-link" disabled={state.loading || state.saving} onClick={() => { void modelSettings.load(); }}>Reload</button></p>}
    {state.warning && <p role="status">{state.warning}</p>}
    {state.loading ? <p>Loading models...</p> : <div className="yard-setting-group">
      <Row label="Model"><select aria-label="Model" value={state.model ?? ''} disabled={state.saving || state.models.length === 0}
        onChange={event => modelSettings.setModel(event.target.value)}>
        {!state.model && <option value="">Default</option>}
        {state.model && !selected && <option value={state.model}>{state.model}</option>}
        {state.models.map(model => <option key={model.id} value={model.model}>{model.displayName || model.model}{model.isDefault ? ' (default)' : ''}</option>)}
      </select></Row>
      <Row label="Reasoning effort"><select aria-label="Reasoning effort" value={state.effort ?? ''} disabled={state.saving || efforts.length === 0}
        onChange={event => modelSettings.setEffort(event.target.value)}>
        {!state.effort && <option value="">Default</option>}
        {state.effort && !efforts.some(item => item.reasoningEffort === state.effort) && <option value={state.effort}>{state.effort}</option>}
        {efforts.map(item => <option key={item.reasoningEffort} value={item.reasoningEffort}>{item.reasoningEffort}</option>)}
      </select></Row>
    </div>}
    {dirty && <div className="yard-inline-save"><span>Unsaved model settings</span><div className="yard-actions">
      <button type="button" disabled={state.saving} onClick={() => modelSettings.discard()}>Discard</button>
      <button type="button" disabled={state.saving || Boolean(state.writeError)} onClick={() => { void modelSettings.save(); }}>{state.saving ? 'Saving...' : 'Save'}</button>
    </div></div>}
  </>;
}
