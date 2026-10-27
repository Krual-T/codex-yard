import { rendererAssets } from './renderer-assets.ts';

export const webManifest = {
  id: '/',
  name: 'Codex Yard',
  short_name: 'Yard',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  icons: [{ src: rendererAssets.brandIcon, sizes: '240x240', type: 'image/png', purpose: 'any' }],
};

// Selectors belong to the fixed 26.1013.40934 renderer. Keep the original
// artwork and status transitions; only the web presentation changes here.
const threadSpinner = '[data-app-action-sidebar-thread-row] [class~="motion-safe:animate-spin"]';
const startupContainer = '#root > [role="presentation"] ._delayedBlossom_ovcb0_16';
const startupLogo = `.startup-loader__logo, ${startupContainer} > ._Root_4m2sz_11`;
const startupOverlay = `.startup-loader__overlay, ${startupContainer} ._Overlay_4m2sz_47`;
const styles = `
${startupContainer} { animation: none; }
@media (prefers-reduced-motion: no-preference) {
  :root:not([data-reduced-motion="true"]) :is(${startupLogo}) {
    opacity: 1;
    animation: workbench-startup-breathe 2400ms ease-in-out infinite;
  }
  :root:not([data-reduced-motion="true"]) ${threadSpinner} {
    animation: workbench-thread-spin 1200ms linear infinite;
    animation-play-state: var(--decorative-animation-play-state, running);
    will-change: transform;
  }
}
@keyframes workbench-thread-spin { to { transform: rotate(360deg); } }
@keyframes workbench-startup-breathe {
  0%, 100% { transform: scale(.96); opacity: .72; }
  50% { transform: scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  ${startupLogo}, ${startupOverlay}, ${threadSpinner} { animation: none; }
  ${startupLogo} { opacity: 1; transform: none; }
}
:root[data-reduced-motion="true"] :is(${startupLogo}, ${startupOverlay}, ${threadSpinner}) { animation: none; }
:root[data-reduced-motion="true"] :is(${startupLogo}) { opacity: 1; transform: none; }
`;

export function withVisualFeedback(html: string): string {
  return html
    .replace(/<title>[^<]*<\/title>/, '<title>Codex Yard</title>')
    // The desktop document defaults to 'none' and has no web manifest policy.
    .replace(/(<meta http-equiv="Content-Security-Policy" content=")/, '$1manifest-src &#39;self&#39;; ')
    .replace('</head>', `
<link rel="icon" type="image/png" sizes="240x240" href="${rendererAssets.brandIcon}">
<link rel="apple-touch-icon" sizes="240x240" href="${rendererAssets.brandIcon}">
<link rel="manifest" href="/site.webmanifest">
<meta name="apple-mobile-web-app-title" content="Codex Yard">
<style data-workbench-visual-feedback>${styles}</style>
</head>`);
}
