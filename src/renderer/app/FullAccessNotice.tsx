import { useEffect, useRef, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import type { SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { useI18n } from '../i18n/index.tsx';

const dismissedAtKey = 'full-access-warning-dismissed-at-v2';
const thirtyDays = 30 * 24 * 60 * 60 * 1000;

/** Keep the reference UI's session dismissal and existing thirty-day atom. */
export function FullAccessNotice({ client, options, sessionDismissed, onDismissSession }: {
  client: WorkbenchClient; options: SubmitOptions | null; sessionDismissed: boolean; onDismissSession(): void;
}) {
  const { locale } = useI18n();
  const chinese = locale.startsWith('zh');
  const [dismissedAt, setDismissedAt] = useState<number | null | undefined>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const current = ++revision.current;
      try {
        const result = await client.host<{ value?: unknown }>('get-persisted-atom', { key: dismissedAtKey });
        if (alive && revision.current === current) {
          setDismissedAt(typeof result.value === 'number' && Number.isFinite(result.value) ? result.value : null);
        }
      } catch (cause) { if (alive && revision.current === current) setError(String(cause)); }
    };
    void read();
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'persisted-atom-updated' || event.type === 'persisted-atoms-changed') void read();
    });
    return () => { alive = false; revision.current++; unsubscribe(); };
  }, [client]);
  const fullAccess = options?.sandboxMode === 'danger-full-access' && options.approvalPolicy === 'never';
  if (!fullAccess || dismissedAt === undefined || sessionDismissed || dismissedAt !== null && Date.now() - dismissedAt <= thirtyDays) return null;
  const dismiss = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const now = Date.now();
      await client.host('set-persisted-atom', { key: dismissedAtKey, value: now });
      setDismissedAt(now);
    } catch (cause) { setError(String(cause)); }
    finally { setSaving(false); }
  };
  return <section className="yard-full-access-notice" aria-label={chinese ? '完全访问已开启' : 'Full access is on'}>
    <ShieldAlert aria-hidden="true" />
    <div><strong>{chinese ? '完全访问已开启' : 'Full access is on'}</strong>
      <p>{chinese ? 'ChatGPT 可以编辑任何文件并运行具有互联网访问权限的命令，无需您的批准。这会增加数据丢失、信息泄露和意外更改的风险。' : 'ChatGPT can edit any file and run commands with internet access without your approval. This increases the risk of data loss, exposed information, and unexpected changes.'}{' '}
        <a href="https://developers.openai.com/codex/security" target="_blank" rel="noreferrer">{chinese ? '了解更多' : 'Learn more'}</a>{chinese ? '关于更高风险的信息。' : ' about elevated risks.'}</p>
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="yard-full-access-dismiss-container"><button type="button" className="yard-full-access-dismiss" disabled={saving} onClick={() => { void dismiss(); }}>{chinese ? '不再显示' : 'Don’t show again'}</button></div>
    <button type="button" className="yard-icon-button" aria-label={chinese ? '关闭' : 'Close'} onClick={onDismissSession}><X aria-hidden="true" /></button>
  </section>;
}
