/** Yard's folders are managed outside the App. Skip desktop cleanup registration
 * when that service is absent; the renderer still awaits thread/archive or
 * thread/unarchive and handles daemon failures through its original flow.
 * Supplying a partial managedWorktrees service would also enable unrelated
 * worktree tools, creation subscriptions and storage UI in this snapshot. */
export function adaptThreadArchiveModule(path: string, content: Buffer): Buffer {
  if (path !== '/assets/app-initial-a68277f60b93.js') return content;
  let source = content.toString('utf8');
  for (const [variable, method] of [['i', 'registerThreadArchive'], ['n', 'registerThreadUnarchive']]) {
    const before = `if(${variable}==null)throw Error(\`Managed worktree archive coordination is unavailable.\`);await ${variable}.${method}(`;
    const after = `if(${variable}==null)return;await ${variable}.${method}(`;
    if (source.split(before).length !== 2) throw new Error('归档适配与固定界面版本不匹配：' + path);
    source = source.replace(before, after);
  }
  return Buffer.from(source);
}
