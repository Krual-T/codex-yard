// Fixed renderer version boundary. Preloads and imports must use the same URL
// so the original application keeps one React runtime and shared module state.
import { projectIconCatalog, type ProjectIcon } from './project-appearance.ts';
import { webRendererPrefix } from './visualizations.ts';
const asset = (name: string) => webRendererPrefix + '/assets/' + name;
export const startupApplicationFile = 'app-initial-a68277f60b93.js';
export const rendererAssets = {
  miniRoute: '/avatar-overlay?initialRoute=%2Favatar-overlay',
  mini: asset('avatar-overlay-native-page-d1ea5f6255c7.js'),
  client: asset('index.client-17f4cd7252fb.js'),
  shared: asset('app-shared-61271c39e3c5.js'),
  rpc: asset('rpc-e690e45d1264.js'),
  application: asset(startupApplicationFile),
  applicationStyle: asset('app-initial-e7c27dd40beb.css'),
  sharedStyle: asset('app-shared-dc7535e633d7.css'),
  userMessageStyle: asset('user-message-5f3d424c6182.css'),
  codeHighlighter: asset('highlight-code-7c4c2ef3d4d8.js'),
  primary: asset('app-primary-f5ea123a0407.js'),
  locale: asset('zh-CN-7ba80cbb133d.js'),
  symbols: asset('browser-ccfd8879f63d.js'),
  bookOpen: asset('book-open-93617afb9c9a.js'),
};

// Static geometry from the pinned renderer's icon catalog. The source
// workspace never imports or executes that catalog's shared module.
export const workspaceIconNames = {
  back: 'arrow-left-lg-light-16',
  sidebar: 'sidebar-light-16',
  sidebarClosed: 'sidebar-hidden-light-16',
  dock: 'dock-light-16',
  summary: 'list-circle-light-16',
  search: 'magnifying-glass-lg-light-16',
  edit: 'square-and-pencil-light-20',
  projectOpen: 'folder-open-light-16',
  gear: 'gear-light-16',
  addContext: 'plus-lg-regular-16',
  more: 'ellipsis-horizontal-light-16',
  plus: 'plus-lg-light-16',
  close: 'xmark-md-light-16',
  closeSmall: 'xmark-md-light-12',
  tabBrowser: 'globe-light-16',
  tabChat: 'chat-bubble-light-16',
  tabFile: 'document-light-16',
  tabTerminal: 'terminal-light-16',
  tabFiles: 'folder-on-folder-light-16',
  panelExpand: 'arrow-up-right-arrow-down-left-sm-light-16',
  panelCollapse: 'arrow-down-left-arrow-up-right-sm-light-16',
  toolFind: 'magnifying-glass-md-light-16',
  toolImage: 'photo-on-tilted-square-light-16',
  toolStop: 'stop-fill-light-16',
  toolAgent: 'robot-light-16',
  toolHand: 'hand-light-16',
  toolMcp: 'circle-grid-2x2-connect-light-16',
  toolSuccess: 'checkmark-lg-light-12',
  toolQuestion: 'circle-questionmark-light-16',
  asyncQuestion: 'chat-bubble-questionmark-light-16',
  pencil: 'pencil-light-16',
  microphone: 'microphone-light-16',
  usageGauge: 'gauge-light-16',
  goalRevert: 'arrow-uturn-left-light-16',
  toolRetry: 'wifi-light-16',
  ...(Object.fromEntries(Object.entries(projectIconCatalog).flatMap(([id, [, name]]) => name
    ? [['project:' + id, name], ['picker:' + id, name.replace(/-16$/, '-20')]] : [])) as
    Record<`${'project' | 'picker'}:${Exclude<ProjectIcon, 'plane'>}`, string>),
} as const;
