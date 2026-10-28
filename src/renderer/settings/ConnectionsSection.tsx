import { useEffect, useRef, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { readConnections, setAutoConnect } from './connections.ts';
import type { ConnectionRow } from './connections.ts';
import { useI18n } from '../i18n/index.tsx';

export function ConnectionsSection({ client, onSavingChange }: { client: WorkbenchClient; onSavingChange: (saving: boolean) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = async () => {
    const current = ++generation.current;
    setLoading(true);
    try { const next = await readConnections(client); if (current === generation.current) setRows(next); }
    catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (current === generation.current) setLoading(false); }
  };
  useEffect(() => {
    void refresh();
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'shared-object-updated' && event.key === 'remote_ssh_connections') void refresh();
    });
    return () => { generation.current++; unsubscribe(); };
  }, [client]);
  const change = async (hostId: string, value: boolean) => {
    setBusy(hostId); onSavingChange(true); setError(null);
    try { await setAutoConnect(client, hostId, value); }
    catch (cause) { setError(`Could not confirm connection change: ${cause instanceof Error ? cause.message : String(cause)}. Check the current state before retrying.`); }
    finally { await refresh(); setBusy(null); onSavingChange(false); }
  };
  return <>
    <div className="yard-section-heading"><h2>{t('Connections')}</h2><button type="button" disabled={loading || busy !== null} onClick={() => { setError(null); void refresh(); }}>{t('Refresh')}</button></div>
    <p className="yard-muted">Turning off auto-connect disconnects this workspace from that host and closes its terminals.</p>
    {error && <p className="yard-setting-error" role="alert">{error}</p>}
    {loading && <p role="status">{t('Loading connections...')}</p>}
    {!loading && !rows.length && !error && <p className="yard-muted">{t('No SSH hosts are registered.')}</p>}
    <div className="yard-setting-group">{rows.map(({ host, state, error: statusError }) => <div className="yard-setting-row" key={host.hostId}>
      <div className="yard-setting-copy"><div className="yard-setting-label">{host.displayName || host.hostId}</div>
        <div className="yard-setting-description">{host.sshAlias || host.sshHost} | {state}</div>
        {statusError && <div className="yard-setting-error">{statusError}</div>}</div>
      <label className="yard-actions"><span>{t('Auto-connect')}</span><input type="checkbox" role="switch" aria-label={`${t('Auto-connect')} ${host.displayName || host.hostId}`}
        checked={host.autoConnect} disabled={busy !== null || loading} onChange={event => { void change(host.hostId, event.target.checked); }} /></label>
    </div>)}</div>
    <p className="yard-muted">Adding or removing SSH hosts, WSL connections, and remote-control connections is unavailable in this web host.</p>
  </>;
}
