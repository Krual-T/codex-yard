import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { Row } from './PreferenceControls.tsx';
import { ModelSettings, resolveConfiguredModel } from './model-settings.ts';
import { translateKnown, useI18n } from '../i18n/index.tsx';

export function ModelSection({ client, hostId, onDirtyChange, onSavingChange }: {
  client: WorkbenchClient; hostId: string; onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
}) {
  const { t } = useI18n();
  const modelSettings = useMemo(() => new ModelSettings(client, hostId), [client, hostId]);
  const state = useSyncExternalStore(modelSettings.subscribe, modelSettings.getSnapshot, modelSettings.getSnapshot);
  const dirty = modelSettings.dirty;
  useEffect(() => { void modelSettings.load(); return () => modelSettings.dispose(); }, [modelSettings]);
  useLayoutEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => { onSavingChange(state.saving || state.draftSaving); }, [state.saving, state.draftSaving, onSavingChange]);
  const selected = resolveConfiguredModel(state.models, state.model);
  const efforts = Array.isArray(selected?.supportedReasoningEfforts) ? selected.supportedReasoningEfforts : [];
  return <>
    <div className="yard-section-heading"><h2>{t('Models')}</h2><button type="button" disabled={dirty || state.loading || state.saving} onClick={() => { void modelSettings.load(); }}>{t('Refresh')}</button></div>
    <p className="yard-muted">{t('Default model and reasoning effort for')} {hostId === 'local' ? t('the local host') : hostId}.</p>
    {state.error && <p className="yard-setting-error" role="alert">{translateKnown(t, state.error)} <button type="button" className="yard-link" disabled={state.loading || state.saving} onClick={() => { void modelSettings.load(); }}>{t('Reload')}</button></p>}
    {state.writeError && <p className="yard-setting-error" role="alert">{state.writeError} <button type="button" className="yard-link" disabled={state.loading || state.saving} onClick={() => { void modelSettings.load(); }}>{t('Reload')}</button></p>}
    {state.draftStorageError && <p className="yard-setting-error" role="alert">Could not save the newer edit in this browser: {state.draftStorageError}{' '}
      <button type="button" onClick={() => { void modelSettings.retryDraftPersistence(); }}>Retry saving edit</button></p>}
    {state.warning && <p role="status">{state.warning}</p>}
    {state.conflicts.map(field => <div key={field} className="yard-setting-error" role="alert">
      <p>{t(field === 'model' ? 'Model' : 'Reasoning effort')} {t('changed elsewhere.')} {t('Current:')} {(field === 'model' ? state.savedModel : state.savedEffort) ?? t('Default')}; {t('Your edit:')} {(field === 'model' ? state.model : state.effort) ?? t('Default')}.</p>
      <div className="yard-actions"><button type="button" disabled={state.saving} onClick={() => modelSettings.resolveConflict(field, 'current')}>{t('Use current value')}</button>
        <button type="button" disabled={state.saving} onClick={() => modelSettings.resolveConflict(field, 'draft')}>{t('Keep my change')}</button></div>
    </div>)}
    {!state.loading && !state.model && !selected && <p className="yard-setting-error" role="alert">{t('The default model is unavailable or ambiguous. Refresh the model list before changing reasoning effort.')}</p>}
    {state.loading ? <p>{t('Loading models...')}</p> : <div className="yard-setting-group">
      <Row label="Model"><select aria-label={t('Model')} value={state.model ?? ''} disabled={state.saving || state.models.length === 0}
        onChange={event => modelSettings.setModel(event.target.value)}>
        {!state.model && <option value="">{t('Default')}</option>}
        {state.model && !selected && <option value={state.model}>{state.model}</option>}
        {state.models.map(model => <option key={model.id} value={model.model}>{model.displayName || model.model}{model.isDefault ? ` (${t('Default')})` : ''}</option>)}
      </select></Row>
      <Row label="Reasoning effort"><select aria-label={t('Reasoning effort')} value={state.effort ?? ''} disabled={state.saving || efforts.length === 0}
        onChange={event => modelSettings.setEffort(event.target.value)}>
        {!state.effort && <option value="">{t('Default')}</option>}
        {state.effort && !efforts.some(item => item.reasoningEffort === state.effort) && <option value={state.effort}>{state.effort}</option>}
        {efforts.map(item => <option key={item.reasoningEffort} value={item.reasoningEffort}>{item.reasoningEffort}</option>)}
      </select></Row>
    </div>}
    {dirty && <div className="yard-inline-save"><span>{t('Unsaved model settings')}</span><div className="yard-actions">
      <button type="button" disabled={state.saving} onClick={() => modelSettings.discard()}>{t('Discard')}</button>
      <button type="button" disabled={state.saving || Boolean(state.writeError) || state.conflicts.length > 0} onClick={() => { void modelSettings.save(); }}>{t(state.saving ? 'Saving...' : 'Save')}</button>
    </div></div>}
  </>;
}
