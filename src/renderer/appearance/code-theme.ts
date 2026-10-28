export type CodeThemeMode = 'light' | 'dark';

/** Semantic colors can also be used by code rendered outside CodeMirror. */
export interface CodeSyntaxColors {
  keyword: string;
  atom: string;
  literal: string;
  string: string;
  definition: string;
  type: string;
  comment: string;
  invalid: string;
}

type Palette = readonly [keyword: string, literal: string, string: string, definition: string, type: string, comment: string, invalid: string];

const palettes: Record<CodeThemeMode, Record<string, Palette>> = {
  light: {
    codex: ['#708', '#219', '#a11', '#00f', '#085', '#940', '#f00'],
    catppuccin: ['#8839ef', '#fe640b', '#40a02b', '#1e66f5', '#179299', '#6c6f85', '#d20f39'],
    absolutely: ['#9c36b5', '#b65c23', '#18865a', '#246fbd', '#167d8d', '#727786', '#c53443'],
    everforest: ['#8f5f8e', '#9a6a22', '#668a3e', '#3a81a0', '#358a78', '#77827a', '#c44343'],
    github: ['#cf222e', '#0550ae', '#0a3069', '#8250df', '#953800', '#6e7781', '#cf222e'],
    gruvbox: ['#9d0006', '#8f3f71', '#79740e', '#076678', '#427b58', '#7c6f64', '#cc241d'],
    linear: ['#6a45b1', '#a15c1c', '#25815c', '#3b64af', '#237786', '#727b86', '#bf313c'],
    notion: ['#9065b0', '#ad602f', '#478860', '#4a77a8', '#388185', '#838078', '#c54545'],
    one: ['#a626a4', '#986801', '#50a14f', '#4078f2', '#c18401', '#696c77', '#e45649'],
    proof: ['#7544a4', '#9d582a', '#347c52', '#285fa3', '#317a88', '#747b86', '#bc3c46'],
    raycast: ['#b8496f', '#a35320', '#448442', '#325fba', '#16828a', '#747983', '#cc3434'],
    'rose-pine': ['#907aa8', '#d7827e', '#286983', '#56949f', '#b4637a', '#797593', '#b4637a'],
    solarized: ['#859900', '#d33682', '#2aa198', '#268bd2', '#b58900', '#657b83', '#dc322f'],
    vercel: ['#a02fa6', '#aa501c', '#15815f', '#1665c1', '#147a85', '#707070', '#d22f37'],
    'vscode-plus': ['#af00db', '#098658', '#a31515', '#795e26', '#267f99', '#6a737d', '#cd3131'],
    xcode: ['#9b2393', '#1c00cf', '#c41a16', '#326d74', '#5c2699', '#667b71', '#d02020'],
  },
  dark: {
    codex: ['#d6a5e8', '#c6b7ff', '#f2ada0', '#a8c7ff', '#8fd5b4', '#d6bd86', '#ffaaa0'],
    ayu: ['#ffb454', '#d2a6ff', '#aad94c', '#ffd580', '#59c2ff', '#8a9199', '#f07178'],
    catppuccin: ['#cba6f7', '#fab387', '#a6e3a1', '#89b4fa', '#94e2d5', '#9399b2', '#f38ba8'],
    absolutely: ['#db9fff', '#f6bd80', '#a5d8ad', '#99bfff', '#85cdd5', '#a0a6b6', '#ff8995'],
    dracula: ['#ff79c6', '#bd93f9', '#f1fa8c', '#50fa7b', '#8be9fd', '#929fc7', '#ff6e6e'],
    everforest: ['#d699b6', '#e69875', '#a7c080', '#7fbbb3', '#83c092', '#9da9a0', '#e67e80'],
    github: ['#ff7b72', '#79c0ff', '#a5d6ff', '#d2a8ff', '#ffa657', '#8b949e', '#ffa198'],
    gruvbox: ['#fb4934', '#d3869b', '#b8bb26', '#83a598', '#8ec07c', '#a89984', '#fb4934'],
    linear: ['#bf9cf9', '#e3a86d', '#9bd5b3', '#9ab8f5', '#8cc9d5', '#9c9eae', '#f5828c'],
    lobster: ['#ff8f9c', '#f7bd7a', '#abd39a', '#9bbcf1', '#8ecfd0', '#a9a1a5', '#ff7c7c'],
    material: ['#c792ea', '#f78c6c', '#c3e88d', '#82aaff', '#89ddff', '#a6accd', '#ff5370'],
    matrix: ['#6fe48e', '#b1f48d', '#91d999', '#c1e79b', '#8ae4cb', '#89a58f', '#f28c8c'],
    monokai: ['#f92672', '#ae81ff', '#e6db74', '#a6e22e', '#66d9ef', '#aaa58f', '#f07178'],
    'night-owl': ['#c792ea', '#f78c6c', '#addb67', '#82aaff', '#7fdbca', '#91a4b5', '#ef5350'],
    nord: ['#81a1c1', '#b48ead', '#a3be8c', '#88c0d0', '#8fbcbb', '#a1aabd', '#bf616a'],
    notion: ['#cfade7', '#dfa780', '#a2cda9', '#a4bee3', '#8ac6c0', '#a5a5a0', '#ee9292'],
    og: ['#c8a6eb', '#e9b37b', '#a4cf9c', '#a0bff0', '#8ac9c5', '#a4a7b2', '#ef8c86'],
    oscurange: ['#ffad66', '#e5aa80', '#afcf86', '#e7bd7a', '#80c9b7', '#aaa39a', '#ff8275'],
    one: ['#c678dd', '#d19a66', '#98c379', '#61afef', '#e5c07b', '#9299a5', '#e06c75'],
    raycast: ['#ff87a2', '#f5af6e', '#a5d985', '#8fb9ff', '#81d4cf', '#a6a7b4', '#ff8080'],
    'rose-pine': ['#c4a7e7', '#ebbcba', '#9ccfd8', '#3e8fb0', '#eb6f92', '#a49cc0', '#eb6f92'],
    sentry: ['#d6a5ff', '#f0ae78', '#a6d49e', '#a5b9ff', '#95cdd5', '#aaa2b3', '#ff858d'],
    solarized: ['#859900', '#d33682', '#2aa198', '#268bd2', '#b58900', '#93a1a1', '#dc322f'],
    temple: ['#e2b5df', '#e7b885', '#b2c998', '#a9bbd9', '#99c8ba', '#aaa59d', '#ef9990'],
    'tokyo-night': ['#bb9af7', '#ff9e64', '#9ece6a', '#7aa2f7', '#2ac3de', '#a0a8c5', '#f7768e'],
    vercel: ['#d79cf3', '#f5b372', '#9bd3ad', '#8dbdff', '#84d1d3', '#a5a5a5', '#ff858d'],
    'vscode-plus': ['#c586c0', '#b5cea8', '#ce9178', '#dcdcaa', '#4ec9b0', '#9aa88a', '#f48771'],
    xcode: ['#fc5fa3', '#d0bf69', '#fc6a5d', '#67b7a4', '#a7c4ff', '#9eacaa', '#ff817b'],
  },
};

export function resolveCodeTheme(mode: CodeThemeMode, requestedId?: string): { id: string; fallback: boolean; colors: CodeSyntaxColors } {
  const id = requestedId && Object.hasOwn(palettes[mode], requestedId) ? requestedId : 'codex';
  const [keyword, atom, string, definition, type, comment, invalid] = palettes[mode][id]!;
  const literal = id === 'codex' ? mode === 'dark' ? '#a8d5aa' : '#164' : atom;
  return { id, fallback: requestedId != null && requestedId !== id, colors: { keyword, atom, literal, string, definition, type, comment, invalid } };
}
