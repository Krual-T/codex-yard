export const rendererComponentsPath = '/renderer-components.js';

/** Two explicit seams in App 26.1013.40934. The upstream files stay intact.
 * Their existing callers initialize React/services and continue to own state.
 * Each wrapper creates its authored child once, inside the same React tree. */
export function adaptMigratedRendererModule(path: string, content: Buffer): Buffer {
  let start: string, end: string, prefix: string, replacement: string;
  if (path === '/assets/app-initial-a68277f60b93.js') {
    start = 'function YEc(e){';
    end = 'function XEc(e){';
    prefix = `import{createSidebarRelativeTimeComponent as __yardCreateRelativeTime}from"${rendererComponentsPath}";let __yardRelativeTime;\n`;
    replacement = 'function YEc(e){return(0,eDc.jsx)(__yardRelativeTime??=__yardCreateRelativeTime(AIa,{useNow:vIa,useIntl:ca,getRelativeUnit:VEc,FormattedMessage:W}),e)}';
  } else if (path === '/assets/collapsible-user-message-content-636c4ff1e0ff.js') {
    start = 'function C(e){';
    end = 'function w(e,t,n){';
    prefix = `import{createCollapsibleUserMessageContentComponent as __yardCreateMessageContent}from"${rendererComponentsPath}";let __yardMessageContent;\n`;
    replacement = 'function C(e){return(0,D.jsx)(__yardMessageContent??=__yardCreateMessageContent(E,{useIsPrinting:()=>ee(x),useTextContentMeasurement:r,registerThreadFindTarget:re,CodeBlockPreviewContext:ne,Button:t,FormattedMessage:a,ChevronDown:te,classNames:m}),e)}';
  } else return content;

  const source = content.toString('utf8');
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0 || source.indexOf(start, from + start.length) !== -1
      || source.indexOf(end, to + end.length) !== -1) {
    throw new Error('React migration does not match the pinned renderer: ' + path);
  }
  return Buffer.from(prefix + source.slice(0, from) + replacement + source.slice(to));
}
