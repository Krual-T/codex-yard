import { useState } from 'react';
import type { ComposerDraftSnapshot } from '../composer/composer-draft-store.ts';

/** The complete result of a committed browser transaction whose projection was not accepted. */
export function BrowserDraftRecoveryNotice({ snapshot, onAccept, onDiscard }: {
  snapshot: ComposerDraftSnapshot; onAccept(): Promise<boolean>; onDiscard(): void;
}) {
  const [error, setError] = useState('');
  const value = JSON.stringify(snapshot, null, 2);
  return <section role="status" className="yard-error" aria-label="Browser draft recovery">
    <strong>浏览器引用已保存，当前输入尚未接收这个版本</strong>
    <p>{snapshot.owner.hostId} / {snapshot.owner.threadId ?? '新会话'} / {snapshot.owner.draftId}</p>
    <details><summary>查看完整已保存版本</summary><pre>{value}</pre></details>
    <button onClick={() => { void onAccept().then(accepted => setError(accepted ? '' : '当前输入未能核对此版本，请复制、另存或处理输入区冲突。')).catch(cause => setError(String(cause))); }}>核对已保存版本</button>
    <button onClick={() => { void (navigator.clipboard?.writeText(value) ?? Promise.reject(new Error('Clipboard unavailable'))).catch(() => setError('复制失败，请展开完整版本并手动复制。')); }}>复制已保存版本</button>
    <button onClick={() => {
      const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'browser-draft-recovery.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>另存已保存版本</button>
    <button onClick={() => { if (window.confirm('放弃此待接收快照？已保存的草稿、批注及输入区冲突都会保留。')) onDiscard(); }}>放弃此待接收快照</button>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
