import { useState } from 'react';
import type { SendIntent } from './send-recovery.ts';

interface Props {
  intent: SendIntent;
  canRetry: boolean;
  onOpen(): Promise<void>;
  onCheck(): Promise<void>;
  onRetry(): Promise<void>;
  onFinish(): Promise<void>;
  onCancel(): Promise<void>;
}

/** The submitted version is immutable; the composer continues to own edits. */
export function SendRecoveryNotice({ intent, canRetry, onOpen, onCheck, onRetry, onFinish, onCancel }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const run = async (operation: () => Promise<void>) => {
    if (pending) return;
    setPending(true); setError('');
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  };
  const retryable = ['prepared', 'ready', 'failed'].includes(intent.stage);
  return <section className="yard-send-recovery" aria-label="Message send recovery">
    <p role="status">{intent.stage === 'confirmed' ? '原提交版本已发送；较新的草稿将保留。'
      : retryable ? '消息尚未发送成功，原提交版本已保留。'
        : '发送结果尚未确认。原提交版本已保留，不会自动重发。'}</p>
    <details><summary>原提交内容 · {intent.owner.hostId}</summary><pre>{intent.draft.text}</pre>
      {intent.draft.images.length > 0 && <p>{intent.draft.images.length} 张图片</p>}
      {intent.draft.files.map(file => <p key={file.path}>{file.path}</p>)}
      {intent.draft.references?.map(reference => <p key={reference.id}>{reference.text}</p>)}
    </details>
    {intent.error && <p>{intent.error}</p>}
    {error && <p role="alert">{error}</p>}
    <div>
      <button disabled={pending} onClick={() => { void run(onOpen); }}>Open original draft</button>
      {intent.stage === 'confirmed' ? <button disabled={pending} onClick={() => { void run(onFinish); }}>Keep newer draft and close</button>
        : <button disabled={pending || !intent.threadId} onClick={() => { void run(onCheck); }}>Check send result</button>}
      {retryable && <>
        <button disabled={pending || !canRetry} onClick={() => { void run(onRetry); }}>Retry original send</button>
        <button disabled={pending} onClick={() => { void run(onCancel); }}>Keep draft and cancel send</button>
      </>}
    </div>
  </section>;
}
