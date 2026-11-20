declare const __yardOutputParserUrl: string;

export function loadMessageReader(): Promise<typeof import('./output-files.ts')> {
  const url = __yardOutputParserUrl;
  return import(url);
}
