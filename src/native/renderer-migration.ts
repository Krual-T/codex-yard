import { createHash } from 'node:crypto';

export const rendererComponentsPath = '/renderer-components.js';

/** Two explicit seams in App 26.1013.40934. The upstream files stay intact.
 * Their existing callers initialize React/services and continue to own state.
 * Each wrapper creates its authored child once, inside the same React tree. */
export function adaptMigratedRendererModule(path: string, content: Buffer): Buffer {
  let start: string, end: string, digest: string, prefix: string, replacement: string;
  if (path === '/assets/app-initial-a68277f60b93.js') {
    start = 'function YEc(e){';
    end = 'function XEc(e){';
    digest = '96ce4a560834164650a4048acc1d050f3a843c1eb5c4678c66842ca948dec287';
    prefix = `import{createSidebarRelativeTimeComponent as __yardCreateRelativeTime}from"${rendererComponentsPath}";let __yardRelativeTime;\n`;
    replacement = 'function YEc(e){return(0,eDc.jsx)(__yardRelativeTime??=__yardCreateRelativeTime(AIa,{useNow:vIa,useIntl:ca,getRelativeUnit:VEc,FormattedMessage:W}),e)}';
  } else if (path === '/assets/collapsible-user-message-content-636c4ff1e0ff.js') {
    start = 'function C(e){';
    end = 'function w(e,t,n){';
    digest = '82f64699f5bf468fbc70ed2e45bb8054d156848afbb85c2ee484f1723d188aef';
    prefix = `import{createCollapsibleUserMessageContentComponent as __yardCreateMessageContent}from"${rendererComponentsPath}";let __yardMessageContent;\n`;
    replacement = 'function C(e){return(0,D.jsx)(__yardMessageContent??=__yardCreateMessageContent(E,{useIsPrinting:()=>ee(x),useTextContentMeasurement:r,registerThreadFindTarget:re,CodeBlockPreviewContext:ne,Button:t,FormattedMessage:a,ChevronDown:te,classNames:m}),e)}';
  } else return content;

  const source = content.toString('utf8');
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0 || source.indexOf(start, from + start.length) !== -1
      || createHash('sha256').update(source.slice(from, to)).digest('hex') !== digest) {
    throw new Error('React migration does not match the pinned renderer: ' + path);
  }
  return Buffer.from(prefix + source.slice(0, from) + replacement + source.slice(to));
}
