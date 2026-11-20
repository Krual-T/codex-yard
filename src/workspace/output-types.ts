import type { PromptAttachment } from './composer-input.ts';

export const outputTypes = [
  { kind: 'document', label: 'Documents', plugin: 'documents@openai-primary-runtime' },
  { kind: 'presentation', label: 'Presentations', plugin: 'presentations@openai-primary-runtime' },
  { kind: 'spreadsheet', label: 'Spreadsheets', plugin: 'spreadsheets@openai-primary-runtime' },
  { kind: 'site', label: 'Sites', plugin: 'sites@openai-curated-remote' },
] as const;

export type OutputType = typeof outputTypes[number];
export type PluginMention = { label: string; plugin: string };
export const validPluginId = (value: string) => /^[\w.-]+@[\w.-]+$/.test(value);
export function pluginMentionPath(mention: PluginMention) { return 'plugin://' + mention.plugin; }
export function pluginMentionMarkup(mention: PluginMention) { return '[@' + mention.label + '](' + pluginMentionPath(mention) + ')'; }

export function pluginMentionSegments(text: string): (string | PluginMention)[] {
  if (!text.includes('](plugin://')) return [text];
  const segments: (string | PluginMention)[] = [];
  let end = 0;
  for (const match of text.matchAll(/\[@([^\]\r\n]+)\]\(plugin:\/\/([\w.-]+@[\w.-]+)\)/g)) {
    if (end < match.index) segments.push(text.slice(end, match.index));
    segments.push({ label: match[1]!, plugin: match[2]! });
    end = match.index + match[0].length;
  }
  if (end < text.length) segments.push(text.slice(end));
  return segments;
}

export type OutputFile = {
  path: string;
  name: string;
  preview: 'html' | 'text' | 'image' | null;
};

const outputFormats = {
  html: /\.html?$/i,
  text: /\.(md|txt|csv)$/i,
  image: /\.(png|jpe?g|webp|gif|avif)$/i,
  download: /\.(pdf|docx|pptx|xlsx)$/i,
};

export function attachmentOutput(file: PromptAttachment): OutputFile {
  const { name, path } = file;
  return { name, path, preview: file.image && outputFormats.image.test(name) ? 'image' :
    outputFormats.text.test(name) ? 'text' : null };
}

export function attachmentUrl(hostId: string, path: string, download = false, name?: string) {
  const query = new URLSearchParams({ hostId, path });
  if (name) query.set('name', name);
  return '/api/files/' + (download ? 'download?' : 'content?') + query;
}

export function workspaceOutputFromLink(href: string, cwd: string): OutputFile | undefined {
  if (!cwd.startsWith('/') || cwd === '/') return;
  try {
    const base = new URL('file://' + cwd.replace(/\/+$/, '').split('/').map(encodeURIComponent).join('/') + '/');
    const directory = decodeURIComponent(base.pathname);
    if (directory === '/') return;
    const url = new URL(href.startsWith('sandbox:/') ? href.slice('sandbox:'.length) : href, base);
    if (url.protocol !== 'file:' || url.host || /%2f|%5c/i.test(url.pathname)) return;
    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith(directory) || /[\x00-\x1f\\]/.test(path)) return;
    const name = path.slice(path.lastIndexOf('/') + 1);
    const preview = outputFormats.html.test(name) ? 'html' : outputFormats.text.test(name) ? 'text' :
      outputFormats.image.test(name) ? 'image' : null;
    if (preview || outputFormats.download.test(name)) return { path, name, preview };
  } catch { /* The URL does not identify a workspace file. */ }
}

export function outputFileUrl(file: OutputFile, action: 'content' | 'download' | 'html-preview', hostId: string, maxBytes?: number) {
  const query = new URLSearchParams({ path: file.path, name: file.name });
  if (hostId !== 'local') query.set('hostId', hostId);
  if (maxBytes) query.set('maxBytes', String(maxBytes));
  return '/api/files/' + action + '?' + query;
}
