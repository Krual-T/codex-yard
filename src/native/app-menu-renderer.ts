/** Add Yard services to the pinned product menu using its existing focus and
 * keyboard navigation components. The unused Work destination is replaced. */
export function adaptYardMenu(path: string, content: Buffer): Buffer {
  if (path !== '/assets/app-initial-a68277f60b93.js') return content;
  const before = 'triggerButton:I,children:[ee,te]';
  const source = content.toString('utf8');
  if (source.split(before).length !== 2) throw new Error('端口转发菜单与固定界面版本不匹配：' + path);
  const item = '(0,p3.jsx)(Ta.Item,{className:`py-2.5 text-base`,SubText:`连接远程服务到你的设备`,onSelect:()=>{setTimeout(()=>window.workbenchOpenPortForwarding?.(),0)},children:`端口转发管理`})';
  return Buffer.from(source.replace(before, `triggerButton:I,children:[${item},te]`));
}
