import type { ReactElement } from 'react';

interface Run { id: string; runStatus: string; threadId: string | null; description: string | null }
export interface AutomationWindow extends Window {
  workbenchAutomationRecovery?: (run: Run, compact?: boolean) => ReactElement | null;
  workbenchResolveAutomation?: (id: string) => Promise<unknown>;
}

/** A recovery action inside the existing run card, sharing its React runtime. */
export function installAutomationRecovery(React: typeof import('react')) {
  const target = window as AutomationWindow, h = React.createElement;
  function Recovery({ run, compact }: { run: Run; compact: boolean }) {
    const [confirm, setConfirm] = React.useState(false), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
    const button = (label: string, action: () => void, disabled = false) => h('button', {
      type: 'button', className: 'text-sm text-secondary underline', disabled, onClick: action,
    }, label);
    async function release() {
      setBusy(true); setError('');
      try {
        if (!target.workbenchResolveAutomation) throw new Error('无法连接 Yard，请刷新页面。');
        await target.workbenchResolveAutomation(run.id); setConfirm(false);
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setBusy(false); }
    }
    return h('div', { className: 'flex flex-col gap-2 px-3 pb-3 text-sm', 'aria-label': '核查运行结果' },
      compact ? h('p', null, run.description) : null,
      run.runStatus !== 'uncertain' ? null : confirm ? h(React.Fragment, null,
        h('p', null, (run.threadId ? '请先打开上方会话核查。' : '本次未取得会话 ID，请先检查近期会话。') + '解除后允许此任务再次调度；此操作不会中断已有会话，也不会重发提示词。'),
        h('div', { className: 'flex gap-3' }, button(busy ? '正在解除…' : '已核查，解除阻塞', () => { void release(); }, busy), button('取消', () => setConfirm(false), busy)),
      ) : button('核查后解除', () => setConfirm(true)),
      error ? h('p', { role: 'alert' }, error) : null,
    );
  }
  target.workbenchAutomationRecovery = (run, compact = false) => run && (run.runStatus === 'uncertain' || compact && ['released', 'failed'].includes(run.runStatus))
    ? h(Recovery, { run, compact, key: run.id }) : null;
}
