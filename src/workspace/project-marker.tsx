import type { ProjectAppearance } from '../native/project-appearance.ts';
import { WorkspaceIcon } from './workspace-icon.tsx';

export function ProjectMarker({ appearance, size = 16, variant }: {
  appearance?: ProjectAppearance | null; size?: number; variant?: 'closed' | 'picker';
}) {
  const marker = appearance?.marker;
  const icon = marker?.kind === 'icon' ? marker.icon : 'folder';
  return <span aria-hidden="true" className="yard-project-marker" data-marker-color={appearance?.color}>
    {marker?.kind === 'emoji' ? <span className="yard-project-marker-emoji">{marker.emoji}</span>
      : <WorkspaceIcon name={variant === 'picker' ? `picker:${icon}` : icon === 'folder' && variant !== 'closed' ? 'projectOpen' : `project:${icon}`} size={size} />}
  </span>;
}
