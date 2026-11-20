import { record } from './protocol.ts';

// The project marker vocabulary is shared by the renderer and native metadata.
export const projectIconCatalog = {
  folder: ['Folder', 'folder-light-16'],
  'currency-dollar': ['Currency Dollar', 'dollarsign-circle-light-16'],
  book: ['Book', 'book-light-16'],
  'graduation-cap': ['Graduation Cap', 'graduation-cap-light-16'],
  edit: ['Pencil', 'pencil-light-16'],
  writing: ['Writing', 'pen-tip-light-16'],
  function: ['Code Brackets', 'braces-light-16'],
  terminal: ['Terminal', 'terminal-light-16'],
  music: ['Music', 'music-note-light-16'],
  popcorn: ['Popcorn', 'popcorn-light-16'],
  customize: ['Customize', 'paintbrush-on-pencil-light-16'],
  palette: ['Palette', 'paint-palette-light-16'],
  stethoscope: ['Stethoscope', 'stethoscope-light-16'],
  health: ['Health', 'star-of-life-light-16'],
  lotus: ['Lotus', 'lotus-light-16'],
  suitcase: ['Suitcase', 'suitcase-light-16'],
  'bar-chart': ['Bar Chart', 'bar-chart-light-16'],
  kettlebell: ['Kettlebell', 'kettlebell-light-16'],
  dumbbell: ['Dumbbell', 'dumbbell-light-16'],
  logs: ['Logs', 'notebook-light-16'],
  scale: ['Balancing Scale', 'balance-scale-light-16'],
  'desk-globe': ['Globe Spin', 'desk-globe-light-16'],
  plane: ['Plane', null],
  globe: ['Globe', 'globe-light-16'],
  wrench: ['Wrench', 'wrench-light-16'],
  paw: ['Paw', 'paw-light-16'],
  flask: ['Flask', 'flask-light-16'],
  brain: ['Brain', 'brain-light-16'],
  heart: ['Heart', 'heart-light-16'],
  plant: ['Plant', 'plant-light-16'],
} as const;

export const projectColors = ['black', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
export type ProjectIcon = keyof typeof projectIconCatalog;
export type ProjectColor = typeof projectColors[number];
export interface ProjectAppearance {
  color: ProjectColor;
  marker: { kind: 'icon'; icon: ProjectIcon } | { kind: 'emoji'; emoji: string };
}
export const defaultProjectAppearance: ProjectAppearance = { color: 'black', marker: { kind: 'icon', icon: 'folder' } };

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function readProjectAppearance(value: unknown): ProjectAppearance | undefined {
  const { color, marker } = record(value);
  if (!projectColors.includes(color as ProjectColor)) return;
  const { kind, icon, emoji } = record(marker);
  const accent = color as ProjectColor;
  if (kind === 'icon' && typeof icon === 'string' && Object.hasOwn(projectIconCatalog, icon)) {
    return { color: accent, marker: { kind, icon: icon as ProjectIcon } };
  }
  if (kind === 'emoji' && typeof emoji === 'string' && emoji.length <= 64
    && /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(emoji)
    && [...graphemes.segment(emoji)].length === 1) return { color: accent, marker: { kind, emoji } };
}
