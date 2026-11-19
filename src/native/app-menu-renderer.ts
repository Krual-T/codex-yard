/** Add Yard services to the pinned product menu using its existing focus and
 * keyboard navigation components. The unused Work destination is replaced. */
export function adaptYardMenu(path: string, content: Buffer): Buffer {
  if (path === '/assets/app-shared-61271c39e3c5.js') {
    // The native portal wraps Content in a custom portal and a display:contents
    // node. Its outer Presence cannot observe Content's exit animation and
    // removes the tree immediately. Let Content's own Presence own unmounting.
    const edits: [string, string][] = [
      ['l=(0,n5.jsx)(Fw,{container:r,children:c})', 'l=(0,n5.jsx)(Fw,{container:r,forceMount:!0,children:c})'],
      ['P=(0,n5.jsx)(Iw,{ref:o,', 'P=(0,n5.jsx)(Iw,{forceMount:!1,ref:o,'],
      // The trigger owns its toggle. Its pointerdown must not also dismiss
      // the retained Content after reopening during an exit.
      ['Ke=e=>{V&&e.target instanceof Node&&ie.current?.contains(e.target)&&e.preventDefault(),k?.(e)}',
        'Ke=e=>{e.target instanceof Node&&ie.current?.contains(e.target)&&e.preventDefault(),k?.(e)}'],
    ];
    let source = content.toString('utf8');
    for (const [before, after] of edits) {
      if (source.split(before).length !== 2) throw new Error('菜单动效与固定界面版本不匹配：' + path);
      source = source.replace(before, after);
    }
    return Buffer.from(source);
  }
  if (path !== '/assets/app-initial-a68277f60b93.js') return content;
  const before = 'triggerButton:I,children:[ee,te]';
  const source = content.toString('utf8');
  if (source.split(before).length !== 2) throw new Error('端口转发菜单与固定界面版本不匹配：' + path);
  const item = '(0,p3.jsx)(Ta.Item,{className:`py-2.5 text-base`,SubText:`连接远程服务到你的设备`,onSelect:()=>{setTimeout(()=>window.workbenchOpenPortForwarding?.(),0)},children:`端口转发管理`})';
  return Buffer.from(source.replace(before, `triggerButton:I,children:[${item},te]`));
}
