export const brandAssets = {
  icon: '/brand/icon.svg',
  apple: '/brand/apple-touch-icon.png',
  icon192: '/brand/icon-192.png',
  icon512: '/brand/icon-512.png',
  maskable: '/brand/icon-maskable-512.png',
};

export const webManifest = {
  id: '/',
  name: 'Codex Yard',
  short_name: 'Yard',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#F4F8FF',
  theme_color: '#193B65',
  icons: [
    { src: brandAssets.icon, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: brandAssets.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: brandAssets.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: brandAssets.maskable, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

// Selectors belong to the fixed 26.1013.40934 renderer. Both startup phases
// use Yard's artwork while the renderer owns the loading/status transitions.
const threadSpinner = '[data-app-action-sidebar-thread-row] [class~="motion-safe:animate-spin"]';
const startupContainer = '#root > [role="presentation"] ._delayedBlossom_ovcb0_16';
const startupLogo = `.startup-loader__logo, ${startupContainer} > ._Root_4m2sz_11`;
const startupOverlay = `.startup-loader__overlay, ${startupContainer} ._Overlay_4m2sz_47`;
// The exact viewBox identifies the pinned Codex wordmark, independently of
// locale. Keep its mode-switch button, accessible label and menu behavior.
const sidebarWordmark = '#app-shell-sidebar button[aria-haspopup="menu"] span:has(> svg[viewBox="0 0 53.225983 18"])';
const styles = `
${startupContainer} { animation: none; }
${startupLogo} {
  width: 56px; height: 56px; opacity: 1;
  background: url("${brandAssets.icon}") center / contain no-repeat;
}
:is(${startupLogo}) > * { visibility: hidden; }
#root [data-testid="home-icon"] {
  background: url("${brandAssets.icon}") center / contain no-repeat;
  opacity: 1;
}
#root [data-testid="home-icon"] > svg { visibility: hidden; }
${sidebarWordmark} > svg { display: none; }
${sidebarWordmark}::before {
  content: ""; width: 22px; height: 22px; margin-inline-end: 8px; flex: none;
  background: url("${brandAssets.icon}") center / contain no-repeat;
}
${sidebarWordmark}::after {
  content: "Codex Yard"; font-size: 17px; font-weight: 600; letter-spacing: -.4px;
}
@media (max-width: 600px) {
  ${sidebarWordmark}::after { content: "Yard"; font-size: 16px; }
}
@media (hover: none), (any-pointer: coarse) {
  /* The desktop project drag wrapper also encloses its conversation list. */
  #app-shell-sidebar .touch-none { touch-action: pan-y pinch-zoom; }
  #app-shell-sidebar [class~="group/folder-row"] {
    --sidebar-row-action-opacity: 1;
    --sidebar-row-action-width: 20px;
    --sidebar-row-menu-width: auto;
    --sidebar-row-menu-overflow: visible;
  }
}
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
<link rel="icon" type="image/png" sizes="192x192" href="${brandAssets.icon192}">
<link rel="icon" type="image/svg+xml" sizes="any" href="${brandAssets.icon}">
<link rel="apple-touch-icon" sizes="180x180" href="${brandAssets.apple}">
<link rel="manifest" href="/site.webmanifest">
<meta name="apple-mobile-web-app-title" content="Codex Yard">
<meta name="theme-color" content="#193B65">
<link rel="preload" as="image" href="${brandAssets.icon}">
<style data-workbench-visual-feedback>${styles}</style>
</head>`);
}
