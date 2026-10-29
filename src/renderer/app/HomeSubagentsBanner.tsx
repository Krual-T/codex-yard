import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import type { ConfigReadSource } from '../../../lib/config-write-protocol.ts';
import { useI18n } from '../i18n/index.tsx';
import { configReadSource, sameConfigSource } from '../settings/config-source.ts';
import { settingsConfigOperations, SettingsWriteError } from '../settings/config-operations.ts';
import type { SettingsWriteRecord } from '../settings/config-operations.ts';
import { userConfigTarget } from '../settings/config-target.ts';
import { subscribeBrowserAtoms } from '../storage/ui-atoms.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import './HomeSubagentsBanner.css';

const seenKey = 'has-seen-multi-agent-composer-banner';
const featureScope = ['features.multi_agent'] as const;
const prompt = 'Spawn a subagent to explore this repo.';
type BannerLabels = readonly [title: string, body: string, action: string, dismiss: string];
const labels: Record<string, BannerLabels> = {
  en: ['Subagents in Codex', 'Delegate work to subagents that work in parallel. Note: may increase token usage.', 'Try now', 'Dismiss subagent banner'],
  zh: ['Codex 中的子智能体', '将任务委派给并行运行的子智能体。注意：这可能会增加 Token 消耗量。', '立即试用', '关闭子智能体横幅'],
  'zh-Hant': ['Codex 中的子代理', '委派工作給可平行運作的子代理。注意：可能會增加 Token 用量。', '立即試用', '關閉子代理橫幅'],
  ja: ['Codex のサブエージェント', '並列で動作するサブエージェントに作業を委任します。注: トークン使用量が増えることがあります。', '今すぐ試す', 'サブエージェントのバナーを閉じる'],
  ko: ['Codex의 하위 에이전트', '병렬로 작업하는 하위 에이전트에 작업을 위임합니다. 참고: 토큰 사용량이 늘어날 수 있습니다.', '지금 사용해 보세요', '하위 에이전트 배너 닫기'],
  es: ['Subagentes en Codex', 'Delega trabajo a subagentes que trabajan en paralelo. Nota: puede aumentar el uso de tókenes.', 'Pruébalo ahora', 'Cerrar anuncio de subagente'],
  'es-419': ['Subagentes en Codex', 'Delega trabajo a subagentes que trabajan en paralelo. Nota: Puede aumentar el uso de tókenes.', 'Pruébalo ahora', 'Descartar el banner del subagente'],
  fr: ['Sous-agents dans Codex', 'Déléguez le travail à des sous-agents qui travaillent en parallèle. Remarque\u00a0: peut augmenter l’utilisation de jetons.', 'Essayer', 'Fermer la bannière des sous-agents'],
  de: ['Subagenten in Codex', 'Delegiere Aufgaben an parallel arbeitende Subagenten. Hinweis: Kann den Tokenverbrauch erhöhen.', 'Jetzt testen', 'Subagenten-Banner schließen'],
  pt: ['Subagentes no Codex', 'Delegue tarefas para subagentes que trabalham em paralelo. Atenção: isso pode aumentar o uso de tokens.', 'Experimente agora', 'Fechar banner de subagente'],
  'pt-PT': ['Subagentes no Codex', 'Delegue trabalho a subagentes que trabalham em paralelo. Nota: pode aumentar a utilização de tokens.', 'Experimente já', 'Fechar banner do subagente'],
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const errorText = (value: unknown) => value instanceof Error ? value.message : String(value);

export interface HomeSubagentsBannerProps {
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  /** Capture the original Main document, owner, navigation and connection synchronously. */
  captureMain(): () => void;
  /** Commit this idempotent prefill to the captured Main composer; do not navigate or send. */
  onTryNow(prompt: string, prefillId: string, assertOriginal: () => void): Promise<void>;
  /** Report a failed or overridden configuration operation through the existing App error surface. */
  onError(message: string): void;
}

type LoadState = { client: WorkbenchClient; hostId: string; cwd: string; seen: boolean | null;
  status: 'loading' | 'ready' | 'error'; enabled: boolean; error?: string };
type Attempt = { operationId: string | null; assertOriginal: () => void; mainGuard: () => void; source: ConfigReadSource;
  targetFile: string; prefilled: boolean; seen: boolean; successful: boolean; warning: string | null };

function isBannerOperation(entry: SettingsWriteRecord, hostId: string): boolean {
  return entry.hostId === hostId && entry.origin.section === 'agent'
    && JSON.stringify(entry.origin.scope ?? []) === JSON.stringify(featureScope);
}

async function featureEnabled(client: WorkbenchClient, hostId: string, current: () => boolean): Promise<boolean> {
  let cursor: string | null = null, enabled: boolean | undefined;
  const cursors = new Set<string>();
  do {
    if (!current()) throw new Error('The original page changed.');
    const page: unknown = await client.rpc('experimentalFeature/list', { cursor, limit: 100 }, hostId);
    if (!current()) throw new Error('The original page changed.');
    if (!object(page) || !Array.isArray(page.data)
      || page.nextCursor != null && (typeof page.nextCursor !== 'string' || !page.nextCursor)) {
      throw new Error('Invalid experimental features response.');
    }
    for (const item of page.data) {
      if (!object(item) || typeof item.name !== 'string' || typeof item.enabled !== 'boolean') throw new Error('Invalid experimental feature.');
      if (item.name === 'multi_agent') {
        if (enabled !== undefined) throw new Error('Duplicate multi-agent feature.');
        enabled = item.enabled;
      }
    }
    cursor = typeof page.nextCursor === 'string' ? page.nextCursor : null;
    if (cursor && (cursors.has(cursor) || cursors.size >= 100)) throw new Error('Experimental feature pagination did not advance.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return enabled === true;
}

async function readTarget(client: WorkbenchClient, hostId: string, cwd: string, assertOriginal: () => void) {
  assertOriginal();
  const read = await client.rpc<{ layers?: unknown; yardConfigSource?: unknown }>('config/read',
    { includeLayers: true, cwd }, hostId, { assertBeforeSend: assertOriginal });
  assertOriginal();
  const source = configReadSource(read?.yardConfigSource, hostId);
  if (!source) throw new Error('The original configuration source is unavailable.');
  const result = userConfigTarget(read.layers, source.codexHome);
  if (!result.target) throw new Error(result.error);
  return { source, target: result.target };
}

/** The parent supplies the Main composer authority; this component never sends a conversation. */
export function HomeSubagentsBanner({ client, hostId, cwd, captureMain, onTryNow, onError }: HomeSubagentsBannerProps) {
  const { locale, t } = useI18n();
  const traditional = /^zh-(?:TW|HK|MO|Hant)/i.test(locale), chinese = /^zh(?:-|$)/i.test(locale);
  const text = (en: string, zh: string, tw = zh) => chinese ? traditional ? tw : zh : en;
  const language = locale.toLowerCase();
  const labelKey = traditional ? 'zh-Hant' : language === 'es-419' ? 'es-419' : language === 'pt-pt' ? 'pt-PT' : language.split('-')[0]!;
  const [title, body, action, dismissLabel] = labels[labelKey] ?? labels.en!;
  const operations = useMemo(() => settingsConfigOperations(client), [client]);
  const writes = useSyncExternalStore(operations.subscribe, operations.getSnapshot, operations.getSnapshot);
  const [load, setLoad] = useState<LoadState>({ client, hostId, cwd, seen: null, status: 'loading', enabled: false });
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false), mounted = useRef(true), attempt = useRef<Attempt | null>(null), readGeneration = useRef(0);
  const scope = useRef({ client, hostId, cwd });
  scope.current = { client, hostId, cwd };
  const currentLoad = load.client === client && load.hostId === hostId && load.cwd === cwd
    ? load : { client, hostId, cwd, seen: null, status: 'loading' as const, enabled: false };
  const entries = writes.records.filter(entry => isBannerOperation(entry, hostId));
  const isLive = () => mounted.current && scope.current.client === client && scope.current.hostId === hostId && scope.current.cwd === cwd;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { void operations.refresh(); }, [operations]);
  useEffect(() => {
    let active = true;
    const generation = ++readGeneration.current;
    const current = () => active && generation === readGeneration.current && isLive();
    const read = async () => {
      let observedSeen: boolean | null = null;
      setLoad({ client, hostId, cwd, seen: null, status: 'loading', enabled: false });
      try {
        const atom = await client.host<{ value?: unknown }>('get-persisted-atom', { key: seenKey });
        if (!current()) return;
        if (atom.value !== undefined && typeof atom.value !== 'boolean') throw new Error('The saved banner preference is invalid.');
        const seen = atom.value === true;
        observedSeen = seen;
        if (seen) { setLoad({ client, hostId, cwd, seen, status: 'ready', enabled: false }); return; }
        setLoad({ client, hostId, cwd, seen, status: 'loading', enabled: false });
        const enabled = await featureEnabled(client, hostId, current);
        if (current()) setLoad({ client, hostId, cwd, seen, status: 'ready', enabled });
      } catch (cause) {
        if (current()) setLoad({ client, hostId, cwd, seen: observedSeen, status: 'error', enabled: false, error: errorText(cause) });
      }
    };
    void read();
    const unsubscribe = subscribeBrowserAtoms(keys => {
      if (!keys.length || keys.includes(seenKey)) { readGeneration.current++; setRevision(value => value + 1); }
    });
    const unsubscribeClient = client.subscribe(event => {
      if (event.type === 'connection-state' || event.type === 'codex-app-server-connection-changed' && event.hostId === hostId && event.isSnapshot !== true) {
        readGeneration.current++;
        setRevision(value => value + 1);
      }
    });
    return () => { active = false; unsubscribe(); unsubscribeClient(); };
  }, [client, hostId, cwd, revision]);

  const captured = () => {
    const original = captureMain();
    if (typeof original !== 'function') throw new Error('The original composer authority is unavailable.');
    const assertOriginal = () => {
      if (!isLive()) throw new Error('The original page changed.');
      const value: unknown = original();
      if (value && typeof (value as { then?: unknown }).then === 'function') throw new Error('The original composer guard must be synchronous.');
    };
    return { assertOriginal, mainGuard: original };
  };
  const fail = (cause: unknown) => {
    const message = errorText(cause);
    if (isLive()) setError(message);
    onError(message);
  };
  const run = (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    void work().catch(fail).finally(() => { busyRef.current = false; if (mounted.current) setBusy(false); });
  };
  const finishAttempt = async (original: Attempt) => {
    if (!original.operationId) throw new Error('The original configuration operation is unavailable.');
    original.assertOriginal();
    const current = await readTarget(client, hostId, cwd, original.assertOriginal);
    if (!sameConfigSource(original.source, current.source) || current.target.file !== original.targetFile) {
      throw new Error('The original configuration source changed. Check the preserved operation.');
    }
    if (!original.prefilled) {
      await onTryNow(prompt, original.operationId, original.mainGuard);
      original.prefilled = true;
    }
    original.assertOriginal();
    if (!original.seen) {
      await client.host('set-persisted-atom', { key: seenKey, value: true }, { assertBeforeSend: original.assertOriginal });
      original.seen = true;
    }
    if (original.warning) onError(original.warning);
    if (original.successful && !original.warning) {
      await operations.finish(original.operationId);
    }
    attempt.current = null;
  };
  const tryNow = () => {
    let authority: ReturnType<typeof captured>;
    try { authority = captured(); authority.assertOriginal(); } catch (cause) { fail(cause); return; }
    const { assertOriginal, mainGuard } = authority;
    run(async () => {
      await operations.refresh(); assertOriginal();
      const snapshot = operations.getSnapshot();
      if (snapshot.error) throw new Error(snapshot.error);
      if (snapshot.records.some(entry => isBannerOperation(entry, hostId)) || snapshot.localRetry.length) {
        throw new Error('Check the original configuration operation before trying again.');
      }
      const { source, target } = await readTarget(client, hostId, cwd, assertOriginal);
      const original: Attempt = { operationId: null, assertOriginal, mainGuard, source, targetFile: target.file,
        prefilled: false, seen: false, successful: false, warning: null };
      attempt.current = original;
      try {
        const submitted = await operations.submit(hostId, 'config/batchWrite', {
          edits: [{ keyPath: 'features.multi_agent', value: true, mergeStrategy: 'upsert' }],
          filePath: target.filePath, expectedVersion: target.version, reloadUserConfig: true,
        }, { section: 'agent', scope: featureScope, source, draft: { feature: 'multi_agent', enabled: true, cwd } },
        () => { try { assertOriginal(); return true; } catch { return false; } }, id => { original.operationId = id; });
        if (!object(submitted.result) || submitted.result.status !== 'ok' && submitted.result.status !== 'okOverridden') {
          throw new Error('The original configuration receipt could not be verified.');
        }
        original.successful = true;
        if (submitted.result.status === 'okOverridden') original.warning = 'A higher-priority configuration overrides this change. Check the original operation.';
      } catch (cause) {
        if (!(cause instanceof SettingsWriteError) || cause.uncertain) throw cause;
        await operations.refresh();
        const entry = operations.getSnapshot().records.find(item => item.operationId === original.operationId);
        if (!entry || entry.phase !== 'finished' && entry.phase !== 'not-started') throw cause;
        original.warning = errorText(cause);
      }
      await finishAttempt(original);
    });
  };
  const dismiss = () => {
    let assertOriginal: () => void;
    try { assertOriginal = captured().assertOriginal; assertOriginal(); } catch (cause) { fail(cause); return; }
    run(async () => {
      await client.host('set-persisted-atom', { key: seenKey, value: true }, { assertBeforeSend: assertOriginal });
      assertOriginal();
    });
  };
  const runRecovery = (action: () => Promise<void>) => run(async () => { await action(); await operations.refresh(); });
  const outstandingLocal = attempt.current?.operationId && writes.localRetry.includes(attempt.current.operationId)
    && !entries.some(entry => entry.operationId === attempt.current?.operationId) ? attempt.current.operationId : null;
  const recovery = entries.length > 0 || !!outstandingLocal;
  if (currentLoad.status === 'ready' && currentLoad.seen === true && !recovery && !error && !writes.error) return null;
  if (currentLoad.status === 'ready' && currentLoad.enabled && !recovery && !error && !writes.error) return null;

  return <section className="yard-home-subagents-banner" aria-label={title}>
    {currentLoad.status === 'loading' && !recovery ? <p className="yard-home-subagents-banner__status" role="status">{t('Loading experimental features...')}</p> : null}
    {currentLoad.status === 'error' && !recovery ? <p className="yard-home-subagents-banner__status" role="alert">{t('Could not load experimental features:')} {currentLoad.error}{' '}
      <button type="button" onClick={() => setRevision(value => value + 1)}>{t('Retry')}</button></p> : null}
    {currentLoad.status === 'ready' && !currentLoad.seen && !currentLoad.enabled && <div className="yard-home-subagents-banner__content">
      <div className="yard-home-subagents-banner__lead"><span className="yard-home-subagents-banner__icon" aria-hidden="true">
        <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="14" cy="9.5" r="3" /><circle cx="5" cy="10.5" r="2.5" /><circle cx="23" cy="10.5" r="2.5" />
          <path d="M8 21c0-3 2.7-5 6-5s6 2 6 5M1 20c0-2.5 1.8-4 4.2-4 .5 0 1 .1 1.5.3M27 20c0-2.5-1.8-4-4.2-4-.5 0-1 .1-1.5.3" />
        </svg></span>
        <div className="yard-home-subagents-banner__copy"><strong>{title}</strong><p>{body}</p></div></div>
      <div className="yard-home-subagents-banner__actions"><button className="yard-home-subagents-banner__try" type="button" disabled={busy || recovery || writes.loading || !!writes.error} onClick={tryNow}>{action}</button>
        <button className="yard-home-subagents-banner__dismiss" type="button" disabled={busy} onClick={dismiss} title={dismissLabel} aria-label={dismissLabel}><X aria-hidden="true" /></button></div>
    </div>}
    {error && <p className="yard-home-subagents-banner__status" role="alert">{error}</p>}
    {writes.error && <p className="yard-home-subagents-banner__status" role="alert">{writes.error}{' '}
      <button type="button" disabled={busy} onClick={() => { void operations.refresh(); }}>{t('Retry')}</button></p>}
    {recovery && <div className="yard-home-subagents-banner__recovery" aria-label={text('Configuration save recovery', '配置保存恢复', '設定儲存復原')}>
      {outstandingLocal && <p>{text('The original browser receipt has not been saved.', '原始浏览器回执尚未保存。', '原始瀏覽器回執尚未儲存。')}{' '}
        <button type="button" disabled={busy} onClick={() => runRecovery(() => operations.retryLocal(outstandingLocal))}>{text('Retry saving browser receipt', '重试保存浏览器回执', '重試儲存瀏覽器回執')}</button></p>}
      {entries.map(entry => {
        const unresolved = entry.phase === 'pending' || entry.phase === 'unknown' || entry.phase === 'blocked';
        const target = entry.phase === 'blocked' ? entry.blocker : entry.operation;
        const localRetry = writes.localRetry.includes(entry.operationId);
        const canContinue = attempt.current?.operationId === entry.operationId && !unresolved && !target?.storageError && !localRetry;
        return <div key={entry.operationId}>
          <p>{text('Original configuration operation', '原始配置操作', '原始設定操作')}: <code>{entry.operationId}</code> ({entry.phase})</p>
          {entry.error && <p role="alert">{entry.error}</p>}
          {unresolved && <button type="button" disabled={busy || localRetry || writes.inFlight.includes(entry.operationId)} onClick={() => runRecovery(() => operations.check(entry.operationId))}>{text('Check original operation', '核对原始操作', '核對原始操作')}</button>}
          {unresolved && (target?.storageError || target?.interrupted || entry.recoveryReceipt || entry.blockerReceipt) && <button type="button" disabled={busy || localRetry} onClick={() => runRecovery(() => operations.check(entry.operationId, true))}>{text('Retry saving host receipt', '重试保存宿主回执', '重試儲存主機回執')}</button>}
          {localRetry && <button type="button" disabled={busy} onClick={() => runRecovery(() => operations.retryLocal(entry.operationId))}>{text('Retry saving browser receipt', '重试保存浏览器回执', '重試儲存瀏覽器回執')}</button>}
          {entry.phase === 'unknown' && entry.hostMissing && entry.notSentEvidence && <button type="button" disabled={busy || localRetry} onClick={() => runRecovery(() => operations.confirmNotSent(entry.operationId))}>{text('Confirm original save was not sent', '确认原始保存未发送', '確認原始儲存未傳送')}</button>}
          {canContinue && <button type="button" disabled={busy} onClick={() => runRecovery(async () => {
            const original = attempt.current;
            if (!original || original.operationId !== entry.operationId) throw new Error('The original composer authority is unavailable.');
            original.successful = entry.operation?.state === 'succeeded';
            original.warning = entry.operation?.terminal?.kind === 'okOverridden' ? 'A higher-priority configuration overrides this change. Check the original operation.'
              : original.successful ? null : entry.error ?? 'The original configuration save did not succeed.';
            await finishAttempt(original);
          })}>{text('Continue original request', '继续原始请求', '繼續原始請求')}</button>}
          {!unresolved && !target?.storageError && !localRetry && <button type="button" disabled={busy} onClick={() => runRecovery(async () => {
            await operations.finish(entry.operationId);
            if (attempt.current?.operationId === entry.operationId) attempt.current = null;
          })}>{text('Close original operation', '关闭原始操作', '關閉原始操作')}</button>}
        </div>;
      })}
    </div>}
  </section>;
}
