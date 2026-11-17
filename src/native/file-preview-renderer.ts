/** Wrap the pinned file tab at its export boundary; vendor files stay intact. */
export function adaptFilePreviewModule(path: string, content: Buffer): Buffer {
  if (path === '/assets/text-file-editor-extensions-f66b2cc71e1d.js') {
    // Keep the editor's Markdown parser and file-relative path resolution.
    // Its desktop app://fs URLs need Yard's bounded HTTP file transport, and
    // SSH editors need the same path context with their selected host.
    const replacements = [
      ['wr=we.define(),$=D.define(', 'YardMarkdownImageHost=D.define({create:()=>`local`,update:e=>e}),wr=we.define(),$=D.define('],
      ['...c===`local`?[$.init(()=>t)]:[]', '$.init(()=>t),YardMarkdownImageHost.init(()=>c??`local`)'],
      ['t.src=ie(this.path)', 't.src=`/api/files/content?`+new URLSearchParams({path:this.path,hostId:e.state.field(YardMarkdownImageHost)})'],
    ];
    let source = content.toString('utf8');
    for (const [before, after] of replacements) {
      if (source.split(before).length !== 2) throw new Error('文件预览与固定界面版本不匹配：' + path);
      source = source.replace(before, after);
    }
    return Buffer.from('var YardMarkdownImageHost;' + source);
  }
  if (path === '/assets/app-initial-a68277f60b93.js') {
    // Plain HTML links fall back to the OS opener. Resolve the conversation's
    // native thread and route scopes before opening its existing text tab.
    const before = 'let r=Date.now(),i=await pa(Zr.openIn.open(n));';
    const after = 'if(e!=null&&n.conversationId!=null&&(n.target==null||n.target===`systemDefault`)&&/\\.html?$/i.test(n.path)){r3o();let t=FJt(e,n.conversationId),r=t==null?null:Rl(t,vb,`/local/${n.conversationId}`);if(r!=null&&e3o(r,n.path,{hostId:n.hostId??`local`,line:n.line,column:n.column,workspaceRoot:n.cwd}))return{success:!0}}' + before;
    const source = content.toString('utf8');
    if (source.split(before).length !== 2) throw new Error('文件预览与固定界面版本不匹配：' + path);
    return Buffer.from(source.replace(before, after));
  }
  if (path !== '/assets/text-file-editor-tab-content.electron-acce0f7941f1.js') return content;
  const before = 'export{Gi as n,Wi as t};';
  const after = 'function YardFilePreview(e){return window.workbenchFilePreview?.(Wi,e)??(0,$.jsx)(Wi,e)}export{Gi as n,YardFilePreview as t};';
  const source = content.toString('utf8');
  if (source.split(before).length !== 2) throw new Error('文件预览与固定界面版本不匹配：' + path);
  return Buffer.from(source.replace(before, after));
}
