import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileText, RefreshCw, Search, X } from 'lucide-react';
import type { WorkbenchClient } from '../../workbench-contract.ts';
import { listSkills, readSkill, removeSkill, setSkillEnabled, skillDisplayName } from './catalog.ts';
import type { Skill, SkillChange, SkillChangeScope, SkillGroup } from './catalog.ts';
import { RecommendedSkills } from './RecommendedSkills.tsx';
import { installRecommendedSkill } from './recommended-catalog.ts';
import type { RecommendedSkill } from './recommended-catalog.ts';
import { definitelyNotChanged } from '../../app/ProductPageChanges.ts';
import './skills.css';

export interface SkillsPageProps {
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  hasUnresolvedChanges: boolean;
  onTrackSkillChange?: (change: SkillChange, operation: () => Promise<void>) => Promise<void>;
  onReconcileSkillChanges?: (scope: SkillChangeScope) => Promise<void>;
  onOpenFile?: (location: { hostId: string; cwd: string; path: string }) => void;
  onTrySkill?: (value: { hostId: string; cwd: string; skill: { name: string; path: string } }) => void | Promise<void>;
  getSkillStatsigOverride?: (skillId: string) => unknown;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function SkillsPage(props: SkillsPageProps) {
  return <SkillsScope key={JSON.stringify([props.hostId, props.cwd])} {...props} />;
}

function SkillsScope({ client, hostId, cwd, hasUnresolvedChanges, onTrackSkillChange, onReconcileSkillChanges, onOpenFile, onTrySkill, getSkillStatsigOverride }: SkillsPageProps) {
  const [groups, setGroups] = useState<SkillGroup[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [revision, setRevision] = useState(0);
  const alive = useRef(false);
  const busyRef = useRef(false);
  const refreshPending = useRef(false);

  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(null);
    void listSkills(client, hostId, cwd, revision > 0).then(result => {
      if (!current) return;
      setGroups(result); setRefreshRequired(false);
      setSelected(previous => previous ? result.flatMap(group => group.skills).find(skill => skill.path === previous.path && skill.name === previous.name) ?? null : null);
    }).catch(cause => { if (current) setError(`Could not load skills: ${message(cause)}`); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, hostId, cwd, revision]);
  useEffect(() => client.subscribe(event => {
    if (event.type !== 'mcp-notification' || event.hostId !== hostId || event.method !== 'skills/changed') return;
    if (busyRef.current) refreshPending.current = true;
    else { setRefreshRequired(true); setRevision(value => value + 1); }
  }), [client, hostId]);

  const scope: SkillChangeScope = { hostId, cwd };
  const locked = uncertain || hasUnresolvedChanges;
  const disabled = loading || busy || locked || refreshRequired || !!error || !onTrackSkillChange;
  const refresh = () => { setNotice(null); setRefreshRequired(true); setRevision(value => value + 1); };
  const reconcile = async () => {
    if (!onReconcileSkillChanges || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      await onReconcileSkillChanges(scope);
      if (alive.current) { setUncertain(false); setMutationError(null); refresh(); }
    } catch (cause) { if (alive.current) setMutationError(`Could not check skill changes: ${message(cause)}`); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const runMutation = async (change: SkillChange, action: () => Promise<void>) => {
    if (!onTrackSkillChange || busyRef.current || loading || locked || refreshRequired || error) return false;
    busyRef.current = true; setBusy(true); setMutationError(null); setNotice(null);
    const execution: { promise: Promise<void> | null; closed: boolean; repeated: boolean } = { promise: null, closed: false, repeated: false };
    try {
      try {
        await onTrackSkillChange(change, () => {
          if (execution.promise || execution.closed || !alive.current) {
            execution.repeated = true;
            return Promise.reject(new Error('Skill change can no longer start'));
          }
          execution.promise = Promise.resolve().then(() => {
            if (!alive.current) throw new Error('Skill host changed before the operation started');
            return action();
          });
          void execution.promise.catch(() => {});
          return execution.promise;
        });
      } finally { execution.closed = true; }
      if (!execution.promise || execution.repeated) throw new Error('Skill change was not executed exactly once');
      await execution.promise;
      return alive.current;
    }
    catch (cause) {
      if (alive.current) {
        const known = definitelyNotChanged(cause);
        setMutationError(known ? `Could not change the skill: ${message(cause)}` : `Could not confirm the change: ${message(cause)}. Check the result before trying again.`);
        setUncertain(!known);
      }
      return false;
    } finally {
      busyRef.current = false;
      if (alive.current) {
        setBusy(false);
        if (refreshPending.current) { refreshPending.current = false; setRefreshRequired(true); setRevision(value => value + 1); }
      }
    }
  };
  const toggle = (skill: Skill, enabled: boolean) => void runMutation({ ...scope, kind: 'setEnabled', path: skill.path, name: skill.name, enabled }, async () => {
    const effective = await setSkillEnabled(client, hostId, skill, enabled);
    if (!alive.current) return;
    setGroups(previous => previous?.map(group => ({ ...group, skills: group.skills.map(item => item.path === skill.path && item.name === skill.name ? { ...item, enabled: effective } : item) })) ?? null);
    setSelected(previous => previous?.path === skill.path && previous.name === skill.name ? { ...previous, enabled: effective } : previous);
    setNotice(effective === enabled ? `${skillDisplayName(skill)} ${effective ? 'enabled' : 'disabled'}.` : `The effective state of ${skillDisplayName(skill)} did not change.`);
  });
  const uninstall = (skill: Skill) => void runMutation({ ...scope, kind: 'remove', path: skill.path }, async () => {
    await removeSkill(client, hostId, skill.path);
    if (!alive.current) return;
    setSelected(null); setNotice(`${skillDisplayName(skill)} uninstalled.`); setRefreshRequired(true); setRevision(value => value + 1);
  });
  const install = (skill: RecommendedSkill) => runMutation({ ...scope, kind: 'installRecommended', skillId: skill.id, repoPath: skill.repoPath, installRoot: null },
    () => installRecommendedSkill(client, hostId, skill, getSkillStatsigOverride?.(skill.id)));
  const filtered = groups?.map(group => ({ ...group, skills: group.skills.filter(skill => {
    const text = `${skillDisplayName(skill)} ${skill.name} ${skill.description} ${skill.scope}`.toLocaleLowerCase();
    return text.includes(query.trim().toLocaleLowerCase());
  }) }));
  const count = filtered?.reduce((sum, group) => sum + group.skills.length, 0) ?? 0;
  const total = groups?.reduce((sum, group) => sum + group.skills.length, 0) ?? 0;

  return <main className="yard-skills">
    <div className="yard-skills-content">
      <header className="yard-skills-header"><div><h1>Skills</h1><p>Skills available in this workspace</p></div>
        <button className="yard-skills-icon" type="button" aria-label="Refresh skills" title="Refresh skills" disabled={loading || busy} onClick={refresh}><RefreshCw size={17} /></button>
      </header>
      <label className="yard-skills-search"><Search size={17} aria-hidden="true" /><span className="yard-skills-sr">Search skills</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search skills" />
      </label>
      {loading && <p role="status" className="yard-skills-muted">Loading skills...</p>}
      {error && <div role="alert" className="yard-skills-error"><span>{error}</span><button type="button" disabled={loading || busy} onClick={refresh}>Retry</button></div>}
      {!onTrackSkillChange && <p className="yard-skills-muted">Skill changes are unavailable on this host.</p>}
      {(mutationError || locked) && <div role="alert" className="yard-skills-error"><span>{mutationError || 'A skill change needs verification.'}</span>
        {locked && <button type="button" disabled={busy || !onReconcileSkillChanges} onClick={() => void reconcile()}>Check changes</button>}</div>}
      {notice && <p role="status" className="yard-skills-muted">{notice}</p>}
      {groups?.flatMap(group => group.errors.map((warning, index) => <p className="yard-skills-warning" key={`${group.cwd}:${warning.path}:${index}`}>{warning.path}: {warning.message}</p>))}
      {!loading && groups && count === 0 && <p className="yard-skills-empty">{total === 0 ? 'No skills found for this workspace.' : 'No skills match your search.'}</p>}
      {filtered?.map((group, index) => group.skills.length > 0 && <section className="yard-skills-group" key={`${group.cwd}:${index}`}>
        {filtered.length > 1 && <h2>{group.cwd || 'Default workspace'}</h2>}
        <ul>{group.skills.map(skill => <li className="yard-skill-row" key={`${skill.path}:${skill.name}`}>
          <button type="button" className="yard-skill-details" onClick={() => setSelected(skill)}>
            <span className="yard-skill-icon"><FileText size={17} aria-hidden="true" /></span>
            <span className="yard-skill-copy"><strong>{skillDisplayName(skill)}</strong><span>{skill.interface?.shortDescription || skill.shortDescription || skill.description}</span></span>
          </button>
          <span className="yard-skill-scope">{skill.scope}</span>
          <label className="yard-skill-toggle"><span className="yard-skills-sr">Enable {skillDisplayName(skill)}</span>
            <input type="checkbox" checked={skill.enabled} disabled={disabled} onChange={event => toggle(skill, event.target.checked)} />
          </label>
        </li>)}</ul>
      </section>)}
      <RecommendedSkills client={client} hostId={hostId} query={query} installed={groups?.flatMap(group => group.skills) ?? []}
        installedLoading={disabled || groups === null} onRefreshInstalled={refresh} onInstall={install} mutationError={mutationError || (locked ? 'A skill change needs verification.' : null)}
        needsCheck={locked} canCheck={!!onReconcileSkillChanges} checking={busy || loading} onCheckChanges={reconcile} />
    </div>
    {selected && <SkillDialog key={`${selected.path}:${selected.name}`} client={client} hostId={hostId} cwd={cwd} skill={selected}
      busy={disabled} onClose={() => setSelected(null)} onToggle={enabled => toggle(selected, enabled)}
      onUninstall={() => uninstall(selected)} onOpenFile={onOpenFile} onTrySkill={onTrySkill}
      mutationError={mutationError || (locked ? 'A skill change needs verification.' : null) || error} notice={notice} onRefresh={refresh} refreshing={loading || busy}
      needsCheck={locked} canCheck={!!onReconcileSkillChanges} onCheckChanges={reconcile} />}
  </main>;
}

interface SkillDialogProps extends Pick<SkillsPageProps, 'client' | 'hostId' | 'cwd' | 'onOpenFile' | 'onTrySkill'> {
  skill: Skill;
  busy: boolean;
  onClose(): void;
  onToggle(enabled: boolean): void;
  onUninstall(): void;
  mutationError: string | null;
  notice: string | null;
  onRefresh(): void;
  refreshing: boolean;
  needsCheck: boolean;
  canCheck: boolean;
  onCheckChanges(): Promise<void>;
}

function SkillDialog({ client, hostId, cwd, skill, busy, onClose, onToggle, onUninstall, onOpenFile, onTrySkill, mutationError, notice, onRefresh, refreshing, needsCheck, canCheck, onCheckChanges }: SkillDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [contents, setContents] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { if (element?.open) element.close(); }; }, []);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(null);
    void readSkill(client, hostId, skill.path).then(value => { if (current) setContents(value); })
      .catch(cause => { if (current) setError(`Could not read skill: ${message(cause)}`); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, hostId, skill.path, revision]);
  const trySkill = async () => {
    if (!onTrySkill || trying) return;
    setTrying(true); setActionError(null);
    try { await onTrySkill({ hostId, cwd, skill: { name: skill.name, path: skill.path } }); }
    catch (cause) { if (alive.current) setActionError(`Could not open a task: ${message(cause)}`); }
    finally { if (alive.current) setTrying(false); }
  };
  return <dialog ref={dialog} className="yard-skill-dialog" aria-labelledby="yard-skill-dialog-title" onClose={onClose}>
    <header><div><h2 id="yard-skill-dialog-title">{skillDisplayName(skill)}</h2><p>{skill.scope} skill</p></div>
      <button className="yard-skills-icon" type="button" aria-label="Close skill details" title="Close" autoFocus onClick={() => dialog.current?.close()}><X size={18} /></button>
    </header>
    <p>{skill.description}</p><p className="yard-skill-path">{skill.path}</p>
    <div className="yard-skill-dialog-actions"><label><input type="checkbox" checked={skill.enabled} disabled={busy} onChange={event => onToggle(event.target.checked)} /> Enabled</label>
      {onOpenFile && <button type="button" onClick={() => onOpenFile({ hostId, cwd, path: skill.path })}>Open file</button>}
      {onTrySkill && <button type="button" disabled={!skill.enabled || busy || trying} onClick={() => void trySkill()}>Try now</button>}
      {hostId === 'local' && skill.scope !== 'admin' && !confirm && <button type="button" disabled={busy} onClick={() => setConfirm(true)}>Uninstall</button>}
    </div>
    {confirm && <div className="yard-skill-confirm" role="group" aria-label="Confirm uninstall"><span>Uninstall {skillDisplayName(skill)}?</span>
      <button type="button" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button><button type="button" disabled={busy} onClick={onUninstall}>Confirm uninstall</button></div>}
    {mutationError && <div role="alert" className="yard-skills-error"><span>{mutationError}</span>{needsCheck
      ? <button type="button" disabled={refreshing || !canCheck} onClick={() => void onCheckChanges()}>Check changes</button>
      : <button type="button" disabled={refreshing} onClick={onRefresh}>Refresh skills</button>}</div>}
    {notice && <p role="status" className="yard-skills-muted">{notice}</p>}
    {actionError && <p role="alert" className="yard-skills-warning">{actionError}</p>}
    <h3>Instructions</h3>
    {loading && <p role="status" className="yard-skills-muted">Loading instructions...</p>}
    {error && <div role="alert" className="yard-skills-error"><span>{error}</span><button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    {contents !== null && <pre>{contents || 'This file is empty.'}</pre>}
  </dialog>;
}
