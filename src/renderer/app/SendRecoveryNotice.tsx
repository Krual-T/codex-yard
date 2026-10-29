import { useState } from 'react';
import type { SendIntent } from './send-recovery.ts';

interface Props {
  intent: SendIntent;
  canRetry: boolean;
  /** The parent has an actual, locally received receipt for this attempt. */
  canCheckInjectionReceipt?: boolean;
  onOpen(): Promise<void>;
  onCheck(): Promise<void>;
  onRetry(): Promise<void>;
  /** Persist the exact pending native receipt; this does not dispatch a write. */
  onRetryInjectionPersistence?(): Promise<void>;
  onFinish(): Promise<void>;
  onCancel(): Promise<void>;
}

function rawContent(intent: SendIntent): string {
  try { return JSON.stringify({ draft: intent.draft, ...(intent.injection ? { injection: intent.injection } : {}) }, null, 2); }
  catch { return '原始内容无法显示为 JSON；请打开仍保留的原稿。'; }
}

/** The submitted version is immutable; the composer continues to own edits. */
export function SendRecoveryNotice({ intent, canRetry, canCheckInjectionReceipt = false, onOpen, onCheck, onRetry,
  onRetryInjectionPersistence, onFinish, onCancel }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const run = async (operation: () => Promise<void>) => {
    if (pending) return;
    setPending(true); setError('');
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  };
  const retryable = ['prepared', 'ready', 'failed'].includes(intent.stage);
  const injection = intent.injection?.phase;
  const native = intent.injection?.native;
  const pendingPersistence = !!native?.status?.pendingPersistence;
  const uncertainInjection = injection === 'sending' || injection === 'unknown';
  const canCheckReceipt = !native && uncertainInjection && canCheckInjectionReceipt && !!intent.attemptId;
  const canCheckNative = !!native && intent.stage !== 'confirmed';
  const canCheckTurn = !!intent.threadId && ['sending', 'unknown'].includes(intent.stage)
    && !native && (injection === undefined || injection === 'confirmed');
  return <section className="yard-send-recovery" aria-label="Message send recovery">
    <p role="status">{intent.stage === 'confirmed' ? '消息已发送；原提交版本的草稿清理待处理，较新的草稿将保留。'
      : pendingPersistence ? '原宿主回执尚未持久保存；请核对并补存原回执。'
      : uncertainInjection ? '原 app 上下文的注入结果尚未确认；原提交版本已保留，不会重复注入或发送。'
      : injection === 'confirmed' && retryable ? '原 app 上下文已确认注入；可继续原发送，无需再次注入。'
      : injection === 'prepared' ? '原 app 上下文尚未注入；原提交版本已保留。'
      : retryable ? '消息尚未发送成功，原提交版本已保留。'
        : '发送结果尚未确认。原提交版本已保留，不会自动重发。'}</p>
    <details><summary>原提交内容 · {intent.owner.hostId}</summary><pre>{intent.draft.text}</pre>
      {intent.draft.images.length > 0 && <p>{intent.draft.images.length} 张图片</p>}
      {intent.draft.files.map(file => <p key={file.path}>{file.path}</p>)}
      {intent.draft.references?.map(reference => <p key={reference.id}>{reference.text}</p>)}
      <details onToggle={event => setShowRaw(event.currentTarget.open)}><summary>完整原始内容</summary>
        {showRaw && <pre>{rawContent(intent)}</pre>}
      </details>
    </details>
    {intent.error && <p>{intent.error}</p>}
    {error && <p role="alert">{error}</p>}
    <div>
      <button disabled={pending} onClick={() => { void run(onOpen); }}>Open original draft</button>
      {intent.stage === 'confirmed' ? <button disabled={pending} onClick={() => { void run(onFinish); }}>Keep newer draft and close</button>
        : canCheckTurn || canCheckReceipt || canCheckNative ? <button disabled={pending} onClick={() => { void run(onCheck); }}>
          {canCheckReceipt ? 'Save confirmed context receipt' : canCheckNative ? 'Check original host status' : 'Check send result'}</button> : null}
      {pendingPersistence && onRetryInjectionPersistence && <button disabled={pending} onClick={() => { void run(onRetryInjectionPersistence); }}>Save original host receipt</button>}
      {intent.stage !== 'confirmed' && retryable && !uncertainInjection && !pendingPersistence &&
        <button disabled={pending || !canRetry} onClick={() => { void run(onRetry); }}>
          {injection === 'confirmed' ? 'Continue original send' : 'Retry original send'}</button>}
      {intent.stage !== 'confirmed' && retryable && !pendingPersistence && (injection === undefined || injection === 'prepared') &&
        <button disabled={pending} onClick={() => { void run(onCancel); }}>Keep draft and cancel send</button>}
    </div>
  </section>;
}
