import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { Instructions } from './instructions.ts';
import { Row } from './PreferenceControls.tsx';
import { useI18n } from '../i18n/index.tsx';

export interface SettingsInstructionEditorProps {
  path: string; text: string; readOnly: boolean; onChange(text: string): void; onSave(): void;
}

export function PersonalizationSection({ client, hostId, InstructionEditor, onDirtyChange, onSavingChange }: {
  client: WorkbenchClient; hostId: string; InstructionEditor: ComponentType<SettingsInstructionEditorProps>;
  onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
}) {
  const { t } = useI18n();
  const instructions = useMemo(() => new Instructions(client, hostId), [client, hostId]);
  const state = useSyncExternalStore(instructions.subscribe, instructions.getSnapshot, instructions.getSnapshot);
  const [memory, setMemory] = useState<{ loading: boolean; status: { v2ConsolidatedThreads: number; v2Ready: boolean } | null; error: string | null }>({ loading: true, status: null, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => { void instructions.load(); return () => instructions.dispose(); }, [instructions]);
  useLayoutEffect(() => { onDirtyChange(instructions.dirty); }, [instructions, state.files, onDirtyChange]);
  useLayoutEffect(() => { onSavingChange(state.saving); }, [state.saving, onSavingChange]);
  useEffect(() => {
    let active = true;
    setMemory(previous => ({ ...previous, loading: true, error: null }));
    void client.rpc<{ v2ConsolidatedThreads: number; v2Ready: boolean }>('memory/status', {}, hostId).then(status => {
      if (!status || !Number.isInteger(status.v2ConsolidatedThreads) || status.v2ConsolidatedThreads < 0 || typeof status.v2Ready !== 'boolean') throw new Error('Invalid memory status response');
      if (active) setMemory({ loading: false, status, error: null });
    }).catch(error => { if (active) setMemory({ loading: false, status: null, error: error instanceof Error ? error.message : String(error) }); });
    return () => { active = false; };
  }, [client, hostId, revision]);
  const refresh = () => { void instructions.load(); setRevision(value => value + 1); };
  return <>
    <div className="yard-section-heading"><h2>{t('Personalization')}</h2><button type="button" disabled={state.loading || state.saving} onClick={refresh}>{t('Refresh')}</button></div>
    <h3>{t('Codex instructions')}</h3>
    <p className="yard-muted">{t('Instructions for')} {hostId === 'local' ? t('the local host') : hostId}. {t('Project instructions may also apply.')}</p>
    {state.error && <p className="yard-setting-error" role="alert">{state.error} <button type="button" className="yard-link" disabled={state.loading || state.saving} onClick={refresh}>{t('Refresh')}</button></p>}
    {state.loading && <p role="status">{t('Loading instructions...')}</p>}
    {state.files?.find(file => file.name === 'AGENTS.override.md')?.saved?.trim() && <p role="status">{t('AGENTS.override.md takes precedence over AGENTS.md.')}</p>}
    {state.files?.map(file => <section className="yard-instruction-editor" key={file.name} data-setting-id={file.name === 'AGENTS.md' ? 'instructions' : undefined}>
      <strong>{file.name}</strong>
      <p className="yard-muted"><code>{file.path}</code>{file.saved === null ? ` ${t('(not created)')}` : ''}</p>
      <InstructionEditor key={`${file.name}:${file.editorRevision}`} path={file.path} text={file.draft} readOnly={state.loading || state.saving}
        onChange={text => instructions.edit(file.name, text)} onSave={() => { void instructions.save(file.name); }} />
      {file.latest !== undefined && <div role="alert" className="yard-setting-error">
        <p>{t('The file changed on the host. Review its current contents before saving your draft.')}</p>
        <details><summary>{t('Current file on host')}</summary><pre className="yard-instructions">{file.latest === null ? t('(File no longer exists)') : file.latest || t('(Empty file)')}</pre></details>
        <button type="button" disabled={file.needsRefresh} onClick={() => instructions.useLatest(file.name)}>{t('Use current file as save baseline')}</button>
        {!file.needsRefresh && <p>{t('Saving afterward will replace the current file with your draft.')}</p>}
      </div>}
      {file.needsRefresh && <p className="yard-setting-error">{t('The previous save has an unknown result. The host must confirm it has ended before another save.')}</p>}
      {file.draft !== (file.saved ?? '') && <div className="yard-inline-save"><span>{t('Unsaved')} {file.name}</span><div className="yard-actions">
        <button type="button" disabled={state.loading || state.saving} onClick={() => instructions.discard(file.name)}>{t('Discard')}</button>
        <button type="button" disabled={state.loading || state.saving || file.needsRefresh || file.latest !== undefined} onClick={() => { void instructions.save(file.name); }}>{t(state.saving ? 'Saving...' : 'Save')}</button>
      </div></div>}
    </section>)}
    <h3>{t('Codex memory')}</h3>
    <div className="yard-setting-group">
      <Row label="Codex memories" description="Memory settings and deleting memories are not available for this connection."
        error={memory.error ? `Could not load memory status: ${memory.error}` : null} retry={() => setRevision(value => value + 1)}>
        <span>{memory.loading ? t('Loading...') : memory.status ? `${memory.status.v2ConsolidatedThreads} consolidated chats; ${memory.status.v2Ready ? 'ready' : 'not ready'}` : t('Unavailable')}</span>
      </Row>
    </div>
    <h3>{t('ChatGPT personalization')}</h3>
    <div className="yard-setting-group">
      <Row label="Custom instructions" description="ChatGPT account instructions are not available for this connection." />
      <Row label="ChatGPT memory" description="ChatGPT account memory is not available for this connection." />
    </div>
  </>;
}
