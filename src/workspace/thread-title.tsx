import { FolderClosed } from 'lucide-react';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';

export function ThreadTitle({ ref, name, project, rename }: {
  ref?: Ref<{ edit(): void }>; name: string; project?: string; rename(name: string): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  useImperativeHandle(ref, () => ({ edit: () => setEditing(true) }), []);
  return <div className="yard-source-tab" data-source-thread-title="">
    {project && <span className="yard-source-tab-project" role="img" aria-label={'Project: ' + project} title={project}>
      <FolderClosed size={14} aria-hidden="true" />
    </span>}
    {editing ? <ThreadNameEditor name={name} rename={rename} finish={() => setEditing(false)} /> :
      <button type="button" className="yard-source-chat-title" title={name} onClick={() => setEditing(true)}>{name}</button>}
  </div>;
}

export function ThreadNameEditor({ name, rename, finish }: { name: string; rename(name: string): Promise<void>; finish(): void }) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const cancelled = useRef(false);
  const [pending, setPending] = useState(false);
  async function save(value: string) {
    if (saving.current || cancelled.current) return;
    const next = value.trim();
    if (!next || next === name) { finish(); return; }
    saving.current = true;
    setPending(true);
    setError(undefined);
    try {
      await rename(next);
      finish();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  return <>
      <input className="yard-source-chat-title" aria-label="Chat title" autoFocus size={Math.max(2, draft.length + 1)}
        value={draft} readOnly={pending} aria-busy={pending} onFocus={event => event.currentTarget.select()}
        onChange={event => setDraft(event.currentTarget.value)} onBlur={event => { if (!error) void save(event.currentTarget.value); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || pending) return;
          if (event.key === 'Escape') {
            event.preventDefault(); cancelled.current = true; finish();
          } else if (event.key === 'Enter') {
            event.preventDefault(); void save(event.currentTarget.value);
          }
        }} />
    {error && <span className="yard-source-title-error" role="alert">{error}</span>}
  </>;
}
