/** Expose the existing native sidebar command path once Yard supplies its
 * complete service. Keep the fixed upstream resource unchanged. */
export function adaptSidebarState(path: string, content: Buffer): Buffer {
  if (path !== '/assets/app-initial-a68277f60b93.js') return content;
  let source = content.toString('utf8');
  const edits = [
    ['xT=Z(q,({get:e})=>e(lg,`68267662`))', 'xT=Z(q,()=>!0)'],
    ['n=t==null?void 0:e(rO)[t];if(n==null)return j9n', 'n=t==null?void 0:e(rO)[t]??e(rO)[``];if(n==null)return j9n'],
    [':e(rO)[t]??j9n}),z9n=', ':e(rO)[t]??e(rO)[``]??j9n}),z9n='],
    // Use Yard's verified per-host contract alongside the fixed UI's 0.148
    // threshold. Keep unsupported hosts in the original client projection.
    ['if(s==null||ws(s))continue;let c=i.get(s)',
      'if(s==null||ws(s)||globalThis.workbenchSidebarSupportsHost?.(s)===!1)continue;let c=i.get(s)'],
    ['async function w5n(e,t,n,r,i){let',
      'async function w5n(e,t,n,r,i){if(globalThis.workbenchSidebarSupportsHost?.(n)===!1)return null;let'],
    // This is only the native command's scratch mapping. The original and
    // optimistic section records retain legacy host mappings and members.
    ['Object.assign(d,l?.hostSectionIds,u?.hostSectionIds),l!=null',
      'Object.assign(d,l?.hostSectionIds,u?.hostSectionIds);for(let host of Object.keys(d))if(globalThis.workbenchSidebarSupportsHost?.(host)===!1)delete d[host];l!=null'],
  ];
  for (const [before, after] of edits) {
    if (source.split(before!).length !== 2) throw new Error('侧栏后端适配与固定界面版本不匹配：' + path);
    source = source.replace(before!, after!);
  }
  // Native groups also work with API keys. Give only the sidebar section
  // records a local scope; leave the global account/authentication unchanged.
  const begin = source.indexOf('function I8n('), end = source.indexOf('async function KO(', begin);
  if (begin < 0 || end < begin) throw new Error('固定界面缺少侧栏分组模块');
  let sections = source.slice(begin, end);
  const accountReads = sections.match(/\b\w+(?:\.get)?\(ST\)/g) ?? [];
  const accountGates = sections.match(/\b\w+(?:\.get)?\(CT\)/g) ?? [];
  if (accountReads.length !== 15 || accountGates.length !== 7) throw new Error('侧栏账号边界与固定界面版本不匹配');
  sections = sections.replace(/\b\w+(?:\.get)?\(ST\)/g, value => '(' + value + '??`yard-app-server`)')
    .replace(/\b\w+(?:\.get)?\(CT\)/g, '!0')
    .replace('if(!e($An))return j9n;', '')
    .replaceAll('e.get(zg).authenticatedAccountId===t', '(e.get(ST)??`yard-app-server`)===t')
    .replaceAll('e.scope.get(zg).authenticatedAccountId!==e.accountId', '(e.scope.get(ST)??`yard-app-server`)!==e.accountId');
  // Other sidebar projections retain their actual account identity.
  sections = sections.replace('let t=e(J8n),n=(e(ST)??`yard-app-server`);', 'let t=e(J8n),n=e(ST);')
    .replace('let t=(e(ST)??`yard-app-server`),n=e(ab),r=e(ob);', 'let t=e(ST),n=e(ab),r=e(ob);');
  source = source.slice(0, begin) + sections + source.slice(end);
  for (const boundary of [
    { begin: 'function QDc(', end: 'function L2(', accounts: 0, gates: 4, allowed: 0 },
    { begin: 'function xAl(', end: 'function AAl(', accounts: 5, gates: 1, allowed: 3 },
    { begin: 'function RXi(', end: 'function zXi(', accounts: 2, gates: 1, allowed: 0 },
    { begin: 'function nZc(', end: 'function sZc(', accounts: 0, gates: 1, allowed: 0 },
  ]) {
    const start = source.indexOf(boundary.begin), finish = source.indexOf(boundary.end, start);
    if (start < 0 || finish < start) throw new Error('固定界面缺少分组入口或查询模块');
    let module = source.slice(start, finish);
    if ((module.match(/\b\w+(?:\.get)?\(ST\)/g)?.length ?? 0) !== boundary.accounts ||
        (module.match(/\b\w+(?:\.get)?\(CT\)/g)?.length ?? 0) !== boundary.gates ||
        (module.match(/\b\w+(?:\.get)?\(\$An\)/g)?.length ?? 0) !== boundary.allowed) throw new Error('分组入口与固定界面版本不匹配');
    module = module.replace(/\b\w+(?:\.get)?\(ST\)/g, value => '(' + value + '??`yard-app-server`)')
      .replace(/\b\w+(?:\.get)?\(CT\)/g, '!0').replace(/\b\w+(?:\.get)?\(\$An\)/g, '!0');
    source = source.slice(0, start) + module + source.slice(finish);
  }
  return Buffer.from(source);
}
