import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Folder } from 'lucide-react';
import { positionComposerMenu } from './composer-menu-position.ts';
import type { ComposerContext, WorkbenchClient } from '../workbench-contract.ts';
import { useI18n } from '../i18n/index.tsx';

export interface ComposerHost { hostId: string; displayName: string }
export interface ComposerTarget { hostId: string; cwd: string }
export interface ComposerProjectDisplay { hostId: string; cwd: string; name: string }
interface TargetProps {
  client: WorkbenchClient;
  context: ComposerContext;
  hosts?: ComposerHost[];
  projectDisplay?: ComposerProjectDisplay | null;
  disabled: boolean;
  onTargetChange(target: ComposerTarget): void | Promise<void>;
}
interface Root { hostId: string; hostName: string; cwd: string }
function key(target: ComposerTarget): string { return JSON.stringify([target.hostId, target.cwd]); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function StandaloneTarget({ client, context, hosts, projectDisplay, disabled, onTargetChange }: TargetProps) {
  const { t } = useI18n('zh-CN');
  const [roots, setRoots] = useState<Root[]>([]);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const hostKey = JSON.stringify(hosts ?? []);
  const availableHosts = useMemo(() => {
    const result = new Map<string, ComposerHost>();
    for (const host of hosts ?? []) if (host.hostId && host.displayName) result.set(host.hostId, host);
    if (!result.has(context.hostId)) result.set(context.hostId, { hostId: context.hostId, displayName: context.hostId });
    return [...result.values()];
  }, [hostKey, context.hostId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.allSettled(availableHosts.map(async host => {
      const response: unknown = await client.host('workspace-root-options', { hostId: host.hostId });
      if (!isRecord(response) || !Array.isArray(response.roots) || !response.roots.every(root => typeof root === 'string')) {
        throw new Error(host.displayName + ' 的工作区列表无效');
      }
      return [...new Set(response.roots.filter(Boolean))].map(cwd => ({ hostId: host.hostId, hostName: host.displayName, cwd }));
    })).then(results => {
      if (!active) return;
      setRoots(results.flatMap(result => result.status === 'fulfilled' ? result.value : []));
      const failures = results.flatMap((result, index) => result.status === 'rejected' ? [availableHosts[index]!.displayName] : []);
      setError(failures.length ? '无法读取工作区：' + failures.join('、') : '');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, availableHosts, version]);
  const current = key(context);
  const options = roots.some(root => key(root) === current) ? roots : [
    { hostId: context.hostId, hostName: availableHosts.find(host => host.hostId === context.hostId)?.displayName ?? context.hostId, cwd: context.cwd },
    ...roots,
  ];
  const change = async (selected: string) => {
    const target = options.find(option => key(option) === selected);
    if (!target || selected === current || changing || disabled || context.threadId !== null) return;
    setChanging(true); setError('');
    try { await onTargetChange({ hostId: target.hostId, cwd: target.cwd }); }
    catch (reason) { setError(t('Could not switch workspace:') + String(reason instanceof Error ? reason.message : reason)); }
    finally { setChanging(false); }
  };
  const unavailable = disabled || changing || loading || context.threadId !== null;
  const projectName = projectDisplay?.hostId === context.hostId && projectDisplay.cwd === context.cwd ? projectDisplay.name.trim() : '';
  return <div className="standalone-composer__target">
    <details className="standalone-composer__menu" onToggle={event => positionComposerMenu(event.currentTarget)}>
      <summary aria-disabled={unavailable} onClick={event => { if (unavailable) event.preventDefault(); }} title={context.cwd || t('No workspace selected')}>
        <Folder size={15} aria-hidden="true" /><span>{projectName || context.cwd || t('No workspace selected')}</span><ChevronDown size={13} aria-hidden="true" />
      </summary>
      <div className="standalone-composer__menu-panel">
        <label>{t('Run location')} <select aria-label={t('Run location')} value={current} disabled={unavailable}
          onChange={event => void change(event.target.value)}>
          {options.map(option => <option key={key(option)} value={key(option)}>{option.hostId === 'local' && option.hostName === 'local' ? t('Local target') : option.hostName}: {option.cwd || t('No workspace selected')}</option>)}
        </select></label>
      </div>
    </details>
    {error ? <span role="alert">{error} <button type="button" onClick={() => setVersion(value => value + 1)}>{t('Retry')}</button></span> : null}
  </div>;
}
