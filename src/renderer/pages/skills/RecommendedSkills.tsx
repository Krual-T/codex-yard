import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FileText, X } from 'lucide-react';
import type { WorkbenchClient } from '../../workbench-contract.ts';
import { readSkill } from './catalog.ts';
import type { Skill } from './catalog.ts';
import { readRecommendedSkills } from './recommended-catalog.ts';
import type { RecommendedCatalog, RecommendedSkill } from './recommended-catalog.ts';

function matchKeys(values: string[]): Set<string> {
  const keys = new Set<string>();
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) continue;
    keys.add(normalized);
    const compact = normalized.replace(/[^a-z0-9]+/g, '');
    if (compact) keys.add(compact);
  }
  return keys;
}

function isInstalled(recommended: RecommendedSkill, installed: Skill[]): boolean {
  const expected = matchKeys([recommended.id, recommended.name, recommended.name.split(':').at(-1) ?? '']);
  return installed.some(skill => {
    const parts = skill.path.split(/[\\/]/);
    const directory = parts.at(-1)?.toLowerCase() === 'skill.md' ? parts.at(-2) ?? '' : parts.at(-1) ?? '';
    return [...matchKeys([skill.name, skill.name.split(':').at(-1) ?? '', directory, skill.interface?.displayName ?? ''])].some(key => expected.has(key));
  });
}

function skillPath(root: string | null, path: string): string | null {
  if (!root || !path || /^[\\/]/.test(path) || /^[A-Za-z]:/.test(path)) return null;
  const parts = path.split(/[\\/]/);
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  if (!parts.at(-1)?.toLowerCase().endsWith('.md')) parts.push('SKILL.md');
  return root.replace(/[\\/]+$/, '') + separator + parts.join(separator);
}

interface Props {
  client: WorkbenchClient;
  hostId: string;
  query: string;
  installed: Skill[];
  installedLoading: boolean;
  onRefreshInstalled(): void;
  onInstall(skill: RecommendedSkill): Promise<boolean>;
  mutationError: string | null;
  needsCheck: boolean;
  canCheck: boolean;
  checking: boolean;
  onCheckChanges(): Promise<void>;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function RecommendedSkills({ client, hostId, query, installed, installedLoading, onRefreshInstalled, onInstall, mutationError, needsCheck, canCheck, checking, onCheckChanges }: Props) {
  const [catalog, setCatalog] = useState<RecommendedCatalog | null>(null);
  const [selected, setSelected] = useState<RecommendedSkill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const alive = useRef(false);
  const installInFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(null);
    void readRecommendedSkills(client, hostId, revision > 0).then(value => {
      if (current) setCatalog(value);
    }).catch(cause => { if (current) setError(`Could not load recommended skills: ${message(cause)}`); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, hostId, revision]);
  useEffect(() => {
    if (installedLoading || !catalog) return;
    setInstalledIds(previous => {
      const pending = previous.filter(id => {
        const skill = catalog.skills.find(entry => entry.id === id);
        return !skill || !isInstalled(skill, installed);
      });
      return pending.length === previous.length ? previous : pending;
    });
  }, [catalog, installed, installedLoading]);

  const refresh = () => { onRefreshInstalled(); setRevision(value => value + 1); };
  const install = async (skill: RecommendedSkill) => {
    if (installInFlight.current || loading || installedLoading || error) return;
    installInFlight.current = true; setInstalling(skill.id);
    try {
      if (await onInstall(skill) && alive.current) { setInstalledIds(ids => [...ids, skill.id]); onRefreshInstalled(); }
    } finally { installInFlight.current = false; if (alive.current) setInstalling(null); }
  };
  const filtered = catalog?.skills.filter(skill => `${skill.name} ${skill.description} ${skill.shortDescription ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  const alreadyInstalled = (skill: RecommendedSkill) => installedIds.includes(skill.id) || isInstalled(skill, installed);
  const controls = (skill: RecommendedSkill) => <button type="button" disabled={loading || installedLoading || !!installing || !!error || alreadyInstalled(skill)} onClick={() => void install(skill)}>
    {alreadyInstalled(skill) ? 'Installed' : installing === skill.id ? 'Installing...' : 'Install skill'}
  </button>;
  return <section className="yard-skills-group yard-recommended" aria-label="Recommended skills">
    <h2>Recommended</h2>
    {loading && <p role="status" className="yard-skills-muted">Loading recommended skills...</p>}
    {error && <div role="alert" className="yard-skills-error"><span>{error}</span><button type="button" disabled={loading || !!installing || installedLoading} onClick={refresh}>Retry recommended skills</button></div>}
    {!loading && catalog && filtered.length === 0 && <p className="yard-skills-muted">{query ? 'No recommended skills match your search.' : 'No recommended skills available.'}</p>}
    <ul>{filtered.map(skill => <li className="yard-skill-row" key={skill.id}>
      <button type="button" className="yard-skill-details" onClick={() => setSelected(skill)}><span className="yard-skill-icon"><FileText size={17} aria-hidden="true" /></span>
        <span className="yard-skill-copy"><strong>{skill.name}</strong><span>{skill.shortDescription || skill.description}</span></span></button>
      {controls(skill)}
    </li>)}</ul>
    {selected && <RecommendedDialog key={selected.id} client={client} hostId={hostId} skill={selected} path={skillPath(catalog?.repoRoot ?? null, selected.repoPath)}
      onClose={() => setSelected(null)} controls={controls(selected)} error={mutationError} onRefresh={refresh} refreshing={loading || !!installing || checking} needsCheck={needsCheck} canCheck={canCheck} onCheckChanges={onCheckChanges} />}
  </section>;
}

function RecommendedDialog({ client, hostId, skill, path, onClose, controls, error, onRefresh, refreshing, needsCheck, canCheck, onCheckChanges }: {
  client: WorkbenchClient; hostId: string; skill: RecommendedSkill; path: string | null; onClose(): void;
  controls: ReactNode; error: string | null; onRefresh(): void; refreshing: boolean;
  needsCheck: boolean; canCheck: boolean; onCheckChanges(): Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [contents, setContents] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { if (element?.open) element.close(); }; }, []);
  useEffect(() => {
    if (!path) { setReadError('Instructions are not available from this catalog.'); return; }
    let current = true; setLoading(true); setReadError(null);
    void readSkill(client, hostId, path).then(value => { if (current) setContents(value); })
      .catch(cause => { if (current) setReadError(`Could not read instructions: ${message(cause)}`); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, hostId, path, revision]);
  return <dialog ref={dialog} className="yard-skill-dialog" aria-labelledby="yard-recommended-title" onClose={onClose}>
    <header><div><h2 id="yard-recommended-title">{skill.name}</h2><p>Recommended skill</p></div>
      <button className="yard-skills-icon" type="button" aria-label="Close skill details" title="Close" autoFocus onClick={() => dialog.current?.close()}><X size={18} /></button></header>
    <p>{skill.description}</p><div className="yard-skill-dialog-actions">{controls}</div>
    {error && <div role="alert" className="yard-skills-error"><span>{error}</span>{needsCheck
      ? <button type="button" disabled={refreshing || !canCheck} onClick={() => void onCheckChanges()}>Check changes</button>
      : <button type="button" disabled={refreshing} onClick={onRefresh}>Refresh skills</button>}</div>}
    <h3>Instructions</h3>
    {loading && <p role="status" className="yard-skills-muted">Loading instructions...</p>}
    {readError && <div role="alert" className="yard-skills-error"><span>{readError}</span>{path && <button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button>}</div>}
    {contents !== null && <pre>{contents || 'This file is empty.'}</pre>}
  </dialog>;
}
