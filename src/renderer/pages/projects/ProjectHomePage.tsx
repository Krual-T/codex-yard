import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { translateKnown, useI18n } from '../../i18n/index.tsx';
import type { ProductLocation } from '../../app/product-routes.ts';
import { readThroughOriginalBridge } from '../product-http-fallback.ts';
import { projectPage } from './catalog.ts';
import type { ProjectEntry, ProjectScope } from './catalog.ts';
import './projects.css';

export interface ProjectHomeResult {
  requestedProjectId: string;
  project: ProjectEntry;
}

export interface ProjectHomePageProps extends ProjectScope {
  projectId: string;
  userKey: string | null;
  location: ProductLocation;
  localProject?: ProjectScope & { userKey: string; routeProjectId: string; projectId: string };
  onLoadProject?: (request: ProjectScope & { projectId: string; signal: AbortSignal }) => Promise<ProjectHomeResult>;
  renderComposer?: (request: ProjectScope & { projectId: string; localProjectId: string | null; project: ProjectEntry | null; location: ProductLocation }) => ReactNode;
  onBack(): void;
}

export function ProjectHomePage({ hostId, accountKey, userKey, projectId, location, localProject, onLoadProject, renderComposer, onBack }: ProjectHomePageProps) {
  const { t } = useI18n();
  const text = (value: string) => translateKnown(t, value);
  const [revision, setRevision] = useState(0);
  const [project, setProject] = useState<ProjectEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setProject(null); setError(null);
    setLoading(true);
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new DOMException('The selected page changed.', 'AbortError');
      return onLoadProject ? onLoadProject({ hostId, accountKey, projectId, signal: controller.signal }) : readThroughOriginalBridge({ kind: 'project', projectId }, controller.signal);
    }).then(value => {
      const checked = projectPage({ items: [value.project], nextCursor: null, warnings: [] }).items[0]!;
      if (value.requestedProjectId !== projectId || checked.hostId !== hostId) throw new Error('The project does not match this route.');
      if (!controller.signal.aborted) setProject(checked);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [hostId, accountKey, projectId, onLoadProject, revision]);
  const localProjectId = localProject && accountKey !== null && userKey !== null && localProject.hostId === hostId && localProject.accountKey === accountKey && localProject.userKey === userKey &&
    localProject.routeProjectId === projectId && localProject.projectId && !localProject.projectId.startsWith('g-p-') ? localProject.projectId : null;
  return <main className="yard-projects"><div className="yard-projects-content">
    <header className="yard-projects-title"><button className="yard-projects-icon" type="button" aria-label={t('Back')} title={t('Back')} onClick={onBack}><ArrowLeft size={17} /></button>
      <h1>{project?.name || text('Project')}</h1></header>
    {loading && <p role="status" className="yard-projects-state">{text('Loading project...')}</p>}
    {error && <div role="alert" className="yard-projects-error">{text('Unable to load project:')} {error}<button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>{t('Retry')}</button></div>}
    {renderComposer ? renderComposer({ hostId, accountKey, projectId, localProjectId, project, location }) : <p className="yard-projects-state">{text('Project chat is unavailable on this host.')}</p>}
  </div></main>;
}
