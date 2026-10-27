import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";import{gzt as t,vMt as n}from"./app-shared-61271c39e3c5.js";function r(e){let t=(0,i.useRef)(e);return(0,i.useInsertionEffect)(()=>void(t.current=e)),(0,i.useCallback)((...e)=>t.current(...e),[])}var i;function a(){return(a=e((()=>{i=t()})))()}function o({children:e,createEditor:t}){let n=r((e,n,r)=>t(e,n,r));return(0,l.jsx)(u.Provider,{value:n,children:e})}function s(){return(0,c.useContext)(u)}var c,l,u;function d(){return(d=e((()=>{a(),c=t(),l=n(),u=(0,c.createContext)(void 0)})))()}function f(){return null}var p,m;function h(){return(h=e((()=>{p={position:`absolute`,top:0,bottom:0,textAlign:`center`,whiteSpace:`normal`,touchAction:`none`},m={display:`contents`}})))()}function g(e,t){return typeof window>`u`&&t!=null?(0,_.jsxs)(_.Fragment,{children:[(0,_.jsx)(`template`,{shadowrootmode:`open`,dangerouslySetInnerHTML:{__html:t}}),e]}):(0,_.jsx)(_.Fragment,{children:e})}var _;function v(){return(v=e((()=>{_=n()})))()}function y(){return(0,b.useContext)(x)}var b,x;function S(){return(S=e((()=>{b=t(),n(),x=(0,b.createContext)(void 0)})))()}function C({alignCommentGutter:e=!1,includeDiffHeader:t,includeSimpleLineSeparators:n,rootSelector:r,surface:i,useReviewLineInfoSeparators:a=!1}){let o=t?`[data-diffs-header],
  ${r}`:r,s=n?`
  :host(.composer-diff-simple-line) [data-separator]:empty {
    background-color: transparent;
  }

  :host(.composer-diff-simple-line) [data-separator]:empty::after {
    content: "";
    grid-column: 2 / 3;
    align-self: center;
    margin-inline: 1ch;
    border-top: 1px solid color-mix(in srgb, var(--diffs-fg) 18%, transparent);
  }
`:``,c=e?`
  ${r} [data-column-number] {
    padding-inline-start: calc(var(--spacing) * 10);
  }
`:``,l=a?`
  ${r} [data-separator='line-info'] [data-expand-button] {
    border-inline-end: 1px solid var(--diffs-bg);
    border-start-start-radius: 8px;
    border-end-start-radius: 8px;
  }

  ${r} [data-separator='line-info'] [data-separator-wrapper][data-separator-multi-button] [data-expand-up] {
    border-end-start-radius: 0;
  }

  ${r} [data-separator='line-info'] [data-separator-wrapper][data-separator-multi-button] [data-expand-down] {
    border-start-start-radius: 0;
  }

  ${r} [data-unified] [data-separator='line-info'] [data-separator-content] {
    border-start-end-radius: 8px;
    border-end-end-radius: 8px;
  }

  ${r} [data-unified] [data-separator='line-info'] [data-separator-wrapper] {
    grid-template-columns: var(--diffs-column-number-width) minmax(0, 1fr);
    padding-inline: var(--diffs-gap-inline, var(--diffs-gap-fallback));
  }

  /* Pierre duplicates split separators into each gutter and content cell. */
  ${r} [data-deletions] [data-gutter] [data-separator='line-info'] [data-separator-wrapper] {
    background-color: var(--diffs-bg);
    border-start-start-radius: 8px;
    border-end-start-radius: 8px;
    grid-template-columns: minmax(0, 1fr);
    padding-inline: var(--diffs-gap-inline, var(--diffs-gap-fallback)) 0;
  }

  ${r} [data-deletions] [data-gutter] [data-separator='line-info'] [data-separator-content],
  ${r} [data-deletions] [data-content] [data-separator='line-info'] [data-expand-button] {
    display: none;
  }

  ${r} [data-deletions] [data-content] [data-separator='line-info'] [data-separator-wrapper] {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    padding: 0;
  }

  ${r} [data-deletions] [data-content] [data-separator='line-info'] [data-separator-content] {
    grid-column: 1;
  }

  ${r} [data-additions] [data-gutter] [data-separator='line-info'],
  ${r} [data-additions] [data-gutter] [data-separator='line-info'] [data-separator-wrapper] {
    background-color: var(--diffs-bg-separator);
  }

  ${r} [data-additions] [data-gutter] [data-separator='line-info'] [data-separator-wrapper] {
    border-start-end-radius: 0;
    border-end-end-radius: 0;
    padding: 0;
  }

  ${r} [data-additions] [data-content] [data-separator='line-info'] [data-separator-wrapper] {
    border-start-end-radius: 8px;
    border-end-end-radius: 8px;
  }
`:``,u=`
  /* Preserve the pre-beta split-column width instead of reserving a scrollbar gutter in every pane. */
  ${r} [data-code] {
    scrollbar-gutter: auto;
  }

  ${r} [data-line-type='change-addition']:is([data-line], [data-no-newline]) {
    --diffs-computed-diff-line-bg: var(--diffs-bg-addition);
  }

  ${r} [data-line-type='change-addition']:is([data-column-number], [data-gutter-buffer]) {
    --diffs-computed-diff-line-bg: var(--codex-diffs-addition-number);
  }

  ${r} [data-line-type='change-deletion']:is([data-line], [data-no-newline]) {
    --diffs-computed-diff-line-bg: var(--diffs-bg-deletion);
  }

  ${r} [data-line-type='change-deletion']:is([data-column-number], [data-gutter-buffer]) {
    --diffs-computed-diff-line-bg: var(--codex-diffs-deletion-number);
  }

  ${r} [data-line-type='change-addition'][data-hovered]:not([data-selected-line]) {
    --diffs-computed-hovered-line-bg: var(--codex-diffs-addition-hover);
  }

  ${r} [data-line-type='change-deletion'][data-hovered]:not([data-selected-line]) {
    --diffs-computed-hovered-line-bg: var(--codex-diffs-deletion-hover);
  }
`;return`
  ${o} {
    ${D}
    --diffs-bg: ${i} !important;
    background-color: ${i} !important;
  }

  ${r} [data-language-symbol-highlight] {
    background-color: var(--color-background-primary-ghost-hover) !important;
  }

  ${r} [data-utility-button] {
    background-color: var(--color-text);
    color: var(--color-surface-secondary);
    border: none;
    border-radius: 4px;
    margin-right: 0;
  }

  ${r} [data-utility-button]:hover {
    background-color: color-mix(
      in srgb,
      var(--color-text) 88%,
      var(--color-surface-secondary)
    );
  }

  ${r} [data-selected-line][data-line-annotation] {
    background-color: var(--diffs-bg);
  }

  [data-placeholder][data-loading] {
    --codex-diffs-placeholder-base: color-mix(
      in srgb,
      var(--color-codex-description) 10%,
      transparent
    );
    --codex-diffs-placeholder-highlight: color-mix(
      in srgb,
      var(--color-codex-description) 16%,
      transparent
    );
    position: relative;
    overflow: hidden;
    background-image: linear-gradient(
      to right,
      var(--codex-diffs-placeholder-base) 0 82%,
      transparent 82%
    );
    background-position: 12px 8px;
    background-size: calc(100% - 24px) 22px;
    background-repeat: repeat-y;
  }

  [data-placeholder][data-loading]::before {
    content: "";
    position: absolute;
    inset: 8px 12px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      var(--codex-diffs-placeholder-highlight) 50%,
      transparent 100%
    );
    transform: translateX(-100%);
    animation: codex-diffs-placeholder-shimmer 3000ms linear infinite;
    mask-image: repeating-linear-gradient(
      to bottom,
      #000 0 14px,
      transparent 14px 22px
    );
  }

  @media (prefers-reduced-motion: reduce) {
    [data-placeholder][data-loading]::before {
      animation: none;
    }
  }

  @keyframes codex-diffs-placeholder-shimmer {
    to {
      transform: translateX(100%);
    }
  }

${u}

  ${r}[data-diff-type="split"] [data-line-type="change-deletion"][data-column-number]::before {
    background-color: var(--diffs-deletion-base);
    background-image: none;
  }

  /* Cover fractional-pixel gaps between consecutive solid change markers. */
  ${r} [data-line-type="change-addition"][data-column-number]
    + [data-line-type="change-addition"][data-column-number]::before,
  ${r}[data-diff-type="split"] [data-line-type="change-deletion"][data-column-number]
    + [data-line-type="change-deletion"][data-column-number]::before {
    contain: none;
    top: -1px;
    height: calc(100% + 1px);
  }

${l}

${c}

${s}`}function w(e,t){return e?t===`diff`?E:T:`var(--color-surface-secondary)`}var T,E,D;function O(){return(O=e((()=>{T=`var(--color-surface)`,E=`var(--color-codex-diff-surface)`,D=`
  --codex-diffs-surface: ${T};
  --codex-diffs-context-surface: color-mix(
  in srgb,
  var(--codex-diffs-surface) 94%,
  var(--color-surface)
);
  --codex-diffs-separator-surface: color-mix(
  in srgb,
  var(--codex-diffs-surface) 94%,
  var(--color-text-info)
);
  --codex-diffs-hover-surface: color-mix(
  in srgb,
  var(--codex-diffs-surface) 92%,
  var(--color-surface)
);
  --codex-diffs-header-surface: var(--codex-diffs-surface);
  --codex-diffs-context-number: color-mix(
  in lab,
  var(--codex-diffs-surface) 98.5%,
  var(--diffs-mixer)
);
  --codex-diffs-addition-number: light-dark(
  color-mix(in lab, var(--diffs-light-bg, #fff) 91%, var(--diffs-addition-base)),
  color-mix(in lab, var(--diffs-dark-bg, #000) 85%, var(--diffs-addition-base))
);
  --codex-diffs-deletion-number: light-dark(
  color-mix(in lab, var(--diffs-light-bg, #fff) 91%, var(--diffs-deletion-base)),
  color-mix(in lab, var(--diffs-dark-bg, #000) 85%, var(--diffs-deletion-base))
);
  --codex-diffs-addition-hover: light-dark(
  color-mix(
    in lab,
    var(--diffs-light-bg, #fff) 80%,
    var(--diffs-addition-base)
  ),
  color-mix(
    in lab,
    var(--diffs-dark-bg, #000) 70%,
    var(--diffs-addition-base)
  )
);
  --codex-diffs-deletion-hover: light-dark(
  color-mix(
    in lab,
    var(--diffs-light-bg, #fff) 80%,
    var(--diffs-deletion-base)
  ),
  color-mix(
    in lab,
    var(--diffs-dark-bg, #000) 75%,
    var(--diffs-deletion-base)
  )
);
  /* Keep unhighlighted lines readable while syntax tokens are pending. */
  --diffs-dark: var(--color-text);
  --diffs-light: var(--color-text);
  --diffs-bg-context-override: var(--codex-diffs-context-surface);
  --diffs-bg-separator-override: var(--codex-diffs-separator-surface);
  --diffs-bg-hover-override: var(--codex-diffs-hover-surface);
`})))()}export{r as _,S as a,g as c,h as d,f,a as g,s as h,x as i,p as l,d as m,C as n,y as o,o as p,O as r,v as s,w as t,m as u};
//# sourceMappingURL=codex-diff-css-222d9e3db1ba.js.map