/** Narrow hooks into the pinned UI. Keep provider state and React code in Yard
 * modules, and retain the upstream menu focus, selection, and effort controls. */
export function adaptModelProviders(path: string, content: Buffer): Buffer {
  const replace = (source: string, before: string, after: string) => {
    if (source.split(before).length !== 2) throw new Error('供应商菜单与固定界面版本不匹配：' + path);
    return source.replace(before, after);
  };
  let source = content.toString('utf8');
  if (path === '/assets/app-primary-f5ea123a0407.js') {
    source = replace(source, 'Ge=u.options.map(e)', 'Ge=window.workbenchProviderOptions({options:u.options,renderOption:e,Item:ji.Item})');
    source = replace(source, 'children:[c,Be,Ve,Ue,We,Ge,u.extras]', 'children:[c,Be,Ve,Ue,window.workbenchHasProviderOptions(u.options)?null:We,Ge,u.extras]');
  } else if (path === '/assets/general-settings-8997e171b11a.js') {
    const start = source.indexOf('function Js(){'), end = source.indexOf('function Ys(){', start);
    if (start < 0 || end < start) throw new Error('供应商设置与固定界面版本不匹配：' + path);
    const part = replace(source.slice(start, end), 'children:[n,i]',
      'children:[n,window.workbenchModelProviderSettings({useHost:()=>L(Dr),Row:V,Toggle:Le,Section:U}),i]');
    source = source.slice(0, start) + part + source.slice(end);
  } else if (path === '/assets/app-initial-a68277f60b93.js') {
    source = replace(source, 'r={...i,supportedReasoningEfforts:t}', 'r={...i,supportedReasoningEfforts:window.workbenchModelEfforts(i,t)}');
    source = replace(source, 'queryFn:({queryKey:e,signal:t})=>{let n=f.getQueryData(e)==null?`interactive`:`background`;',
      'queryFn:({queryKey:e,signal:t})=>{window.workbenchWatchModels(f,e);let n=f.getQueryData(e)==null?`interactive`:`background`;');
  } else return content;
  return Buffer.from(source);
}
