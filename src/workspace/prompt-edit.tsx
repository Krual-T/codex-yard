import { useLayoutEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { mountPromptEditor } from './composer.tsx';
import { AttachmentCard } from './composer-attachments.tsx';
import type { EditablePrompt } from './composer-input.ts';
import { MessageCopy } from './message-copy.tsx';

export function PromptEdit({ prompt, text, change, cancel, send, pending, locked, error, hostId }: {
  prompt: EditablePrompt;
  text: string;
  change(text: string): void;
  cancel(): void;
  send(): void;
  pending: boolean;
  locked: boolean;
  error?: string;
  hostId: string;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>(null);
  const [initial] = useState(text);
  useLayoutEffect(() => {
    if (locked) return;
    const view = mountPromptEditor(mount.current!, initial, 'Edit message', change);
    editor.current = view;
    view.focus();
    return () => { editor.current = null; view.destroy(); };
  }, [initial, change, locked]);
  useLayoutEffect(() => { editor.current?.setProps({ editable: () => !pending }); }, [pending]);
  const canSend = !pending && !locked && (!!text.trim() || prompt.hasFiles);
  const submit = () => { if (canSend && !editor.current?.composing) send(); };
  return <form className="yard-source-prompt-edit rounded-3xl bg-text/5 dark:bg-primary-soft"
    aria-busy={pending} onSubmit={event => { event.preventDefault(); submit(); }}
    onKeyDownCapture={event => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || editor.current?.composing) return;
      if (event.key === 'Escape' && !pending) { event.preventDefault(); cancel(); }
      if (event.key === 'Enter' && event.target === editor.current?.dom && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        if (!event.repeat) submit();
      }
    }}>
    {!!prompt.attachments.length && <div className="yard-source-attachment-row">
      {prompt.attachments.map(file => <AttachmentCard key={file.path} name={file.name} file={file} hostId={hostId} preview={false} />)}
    </div>}
    {locked ? <p className="yard-source-prompt-edit-field" dir="auto">{text}</p> :
      <div ref={mount} className="yard-source-prompt-edit-field _RichTextInput_1ev2o_1 font-content text-base"
        data-rich-text-layout="multiline" data-composer-input-layout="multiline" />}
    {error && <p role="alert" className="yard-source-prompt-edit-error">{error}</p>}
    <footer>
      {locked && <MessageCopy label="Copy edit" text={text} />}
      <button type="button" disabled={pending} onClick={cancel}>{locked ? 'Close' : 'Cancel'}</button>
      {!locked && <button type="submit" disabled={!canSend}>Send</button>}
    </footer>
  </form>;
}
