/** Stage browser File bytes at the pinned composer's existing asynchronous
 * attachment boundary. The native manager keeps pending order and generation
 * checks; the host copies remote bytes without a browser WebSocket round trip. */
export function adaptFileAttachmentModule(path: string, content: Buffer): Buffer {
  if (path !== '/assets/app-initial-a68277f60b93.js') return content;
  const stage = [
    'try{await window.workbenchStageFiles(n.filter(e=>!c?.includes(e)))}',
    'catch(cause){Zq(e,[...d.values()]);if(t.current!==yardGeneration)return;',
    'e.get(yc).danger(l.formatMessage({id:`composer.fileAttachment.browserFileCopyError`,defaultMessage:`Unable to attach file`}),',
    '{description:cause instanceof Error?cause.message:String(cause),errorAnalytics:{toastId:`composer.fileAttachment.browserFileCopyError`}});return}',
    'if(t.current!==yardGeneration){Zq(e,[...d.values()]);return}',
  ].join('');
  const replacements: [string, string][] = [
    ['E=(n,i,o,c,u)=>{if(n.length===0)return;let d=u??D(n);',
      'E=async(n,i,o,c,u)=>{if(n.length===0)return;let d=u??D(n),yardGeneration=t.current;'],
    ['let p=window.electronBridge?.getPathForFile,m=j2o(n,p,i,c)',
      stage + 'let p=window.electronBridge?.getPathForFile,m=j2o(n,p,i,c)'],
    ['qh(e,s).uploadLocalFileAttachments({attachments:u,allowSftpUpload:PMe(o)})',
      'window.workbenchUploadLocalFileAttachments(s,u)'],
  ];
  let source = content.toString('utf8');
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('文件附件与固定界面版本不匹配：' + path);
    source = source.replace(before, after);
  }
  return Buffer.from(source);
}
