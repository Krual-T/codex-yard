import { useEffect, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { Row } from './PreferenceControls.tsx';

type Account = { type: 'apiKey' } | { type: 'chatgpt'; email: string | null; planType: string } | { type: 'amazonBedrock' };
type Window = { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null };
type Credits = { hasCredits: boolean; unlimited: boolean; balance: string | null };
type Limits = { primary: Window | null; secondary: Window | null; limitName?: string | null; limitId?: string | null; credits?: Credits | null };
type Usage = { buckets: Limits[]; credits: Credits | null; ordinaryUsageAllowed: boolean | null };
type Result<T> = { loading: boolean; data: T | null; error: string | null };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const isWindow = (value: unknown): value is Window => value != null && typeof value === 'object' &&
  typeof (value as Window).usedPercent === 'number' && Number.isFinite((value as Window).usedPercent) &&
  (value as Window).usedPercent >= 0 && (value as Window).usedPercent <= 100;
const isLimits = (value: unknown): value is Limits => value != null && typeof value === 'object' && !Array.isArray(value) &&
  'primary' in value && 'secondary' in value &&
  ((value as Limits).primary == null || isWindow((value as Limits).primary)) && ((value as Limits).secondary == null || isWindow((value as Limits).secondary)) &&
  ((value as Limits).limitName == null || typeof (value as Limits).limitName === 'string') && ((value as Limits).limitId == null || typeof (value as Limits).limitId === 'string');
const isCredits = (value: unknown): value is Credits => value != null && typeof value === 'object' &&
  typeof (value as Credits).hasCredits === 'boolean' && typeof (value as Credits).unlimited === 'boolean' &&
  ((value as Credits).balance === null || typeof (value as Credits).balance === 'string');

export function UsageSection({ client, hostId }: { client: WorkbenchClient; hostId: string }) {
  const [account, setAccount] = useState<Result<Account | 'signed-out'>>({ loading: true, data: null, error: null });
  const [limits, setLimits] = useState<Result<Usage>>({ loading: true, data: null, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setAccount(previous => ({ ...previous, loading: true, error: null }));
    setLimits(previous => ({ ...previous, loading: true, error: null }));
    void client.rpc<{ account: Account | null }>('account/read', { refreshToken: false }, hostId).then(result => {
      const value = result?.account;
      if (value !== null && (!value || !['apiKey', 'chatgpt', 'amazonBedrock'].includes(value.type))) throw new Error('Invalid account response');
      if (active) setAccount({ loading: false, data: value || 'signed-out', error: null });
    }).catch(error => { if (active) setAccount({ loading: false, data: null, error: errorMessage(error) }); });
    void client.rpc<{ rateLimits: Limits; rateLimitsByLimitId?: Record<string, Limits> | null; ordinaryUsageAllowed?: boolean | null }>('account/rateLimits/read', {}, hostId).then(result => {
      const value = result?.rateLimits;
      const byId = result?.rateLimitsByLimitId;
      if (!isLimits(value) || byId != null && (typeof byId !== 'object' || Array.isArray(byId) || !Object.values(byId).every(isLimits)) ||
        result.ordinaryUsageAllowed != null && typeof result.ordinaryUsageAllowed !== 'boolean' || value.credits != null && !isCredits(value.credits)) throw new Error('Invalid usage response');
      const buckets = byId == null ? [] : Object.values(byId);
      if (active) setLimits({ loading: false, data: { buckets: buckets.length ? buckets : [value], credits: value.credits ?? null,
        ordinaryUsageAllowed: result.ordinaryUsageAllowed ?? null }, error: null });
    }).catch(error => { if (active) setLimits({ loading: false, data: null, error: errorMessage(error) }); });
    return () => { active = false; };
  }, [client, hostId, revision]);
  const refresh = () => setRevision(value => value + 1);
  const accountLabel = account.data === 'signed-out' ? 'Not signed in' : account.data?.type === 'chatgpt' ? `ChatGPT${account.data.planType ? ` ${account.data.planType}` : ''}` :
    account.data?.type === 'apiKey' ? 'API key' : account.data?.type === 'amazonBedrock' ? 'Amazon Bedrock' : null;
  const format = (window: Window) => {
    const duration = typeof window.windowDurationMins === 'number' && Number.isFinite(window.windowDurationMins) ? ` / ${window.windowDurationMins} min` : '';
    const date = typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt) ? new Date(window.resetsAt * 1000) : null;
    const reset = date && !Number.isNaN(date.getTime()) ? `, resets ${date.toLocaleString()}` : '';
    return `${window.usedPercent}% used${duration}${reset}`;
  };
  return <>
    <div className="yard-section-heading"><h2>Usage</h2><button type="button" disabled={account.loading || limits.loading} onClick={refresh}>Refresh</button></div>
    <p className="yard-muted">Account and usage for {hostId === 'local' ? 'the local host' : hostId}.</p>
    <div className="yard-setting-group"><Row label="Account" error={account.error ? `Could not load account: ${account.error}` : null} retry={refresh}>
      <span>{account.loading ? 'Loading...' : accountLabel}</span></Row>
      <Row label="Usage limits" error={limits.error ? `Could not load usage limits: ${limits.error}` : null} retry={refresh}>
        {limits.loading ? <span>Loading...</span> : limits.data ? <div>{limits.data.buckets.map((bucket, index) => <div key={`${bucket.limitId ?? ''}:${index}`}>
          {(bucket.limitName || bucket.limitId) && <strong>{bucket.limitName || bucket.limitId}</strong>}
          {bucket.primary && <div>{format(bucket.primary)}</div>}{bucket.secondary && <div>{format(bucket.secondary)}</div>}
          {!bucket.primary && !bucket.secondary && <span>No usage limits reported.</span>}
        </div>)}</div> : <span>Unavailable</span>}
      </Row>
      {limits.data?.ordinaryUsageAllowed != null && <Row label="Included usage"><span>{limits.data.ordinaryUsageAllowed ? 'Available' : 'Unavailable'}</span></Row>}
      {limits.data?.credits && <Row label="Credit balance"><span>{limits.data.credits.unlimited ? 'Unlimited' : limits.data.credits.balance ?? (limits.data.credits.hasCredits ? 'Available' : 'Unavailable')}</span></Row>}
    </div>
    <p className="yard-muted">Purchasing credits, usage resets and billing management are not available for this connection.</p>
  </>;
}
