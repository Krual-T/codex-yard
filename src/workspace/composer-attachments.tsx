import { FileText, LoaderCircle, Paperclip, X } from 'lucide-react';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { useId, useLayoutEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import type { PromptAttachment } from './composer-input.ts';
import { stageComposerFile } from './host.ts';
import { attachmentUrl } from './output-types.ts';
import { ImagePreview } from './conversation-images.tsx';

type Upload = { id: string; name: string; file?: PromptAttachment };
type Uploads = { scope: string; items: Upload[]; error?: string };

export function useComposerAttachments(scope: string, hostId: string) {
  const [state, setState] = useState<Uploads>(() => ({ scope, items: [] }));
  const active = useRef<object | null>(null);
  if (state.scope !== scope) setState({ scope, items: [] });
  useLayoutEffect(() => {
    active.current = {};
    return () => { active.current = null; };
  }, [scope]);
  const items = state.scope === scope ? state.items : [];

  function add(files: File[]) {
    const token = active.current;
    if (!token || !files.length) return;
    const added = files.map(file => ({ id: crypto.randomUUID(), name: file.name }));
    setState(previous => ({ scope, items: [...previous.items, ...added] }));
    files.forEach((file, index) => {
      const { id } = added[index]!;
      void stageComposerFile(file, hostId).then(staged => {
        if (active.current !== token) return;
        setState(previous => ({ ...previous, items: previous.items.map(row => row.id === id ? { ...row, file: staged } : row) }));
      }, error => {
        if (active.current !== token) return;
        setState(previous => !previous.items.some(row => row.id === id) ? previous :
          { ...previous, items: previous.items.filter(row => row.id !== id), error: error instanceof Error ? error.message : String(error) });
      });
    });
  }

  function remove(ids: readonly string[]) {
    const removed = new Set(ids);
    setState(previous => ({ ...previous, items: previous.items.filter(row => !removed.has(row.id)) }));
  }

  function restore(files: readonly PromptAttachment[]) {
    if (!files.length) return;
    setState(previous => ({ scope, items: [...previous.items, ...files.filter(file => !previous.items.some(row => row.file?.path === file.path))
      .map(file => ({ id: crypto.randomUUID(), name: file.name, file }))] }));
  }

  return { items, pending: items.some(row => !row.file), error: state.scope === scope ? state.error : undefined, add, remove, restore };
}

export function AttachmentPicker({ add, disabled, picker }: { add(files: File[]): void; disabled: boolean; picker: RefObject<HTMLInputElement | null> }) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  function selected(event: ChangeEvent<HTMLInputElement>) {
    add(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = '';
  }
  return <>
    <button type="button" aria-label="Add files and more" title="Add files and more" className="yard-source-add-context"
      data-composer-navigation-target="add-context" aria-haspopup="dialog" aria-expanded={open} popoverTarget={id} disabled={disabled}
      onClick={event => {
        const body = event.currentTarget.closest('[data-composer-body]')?.getBoundingClientRect();
        if (menu.current && body) Object.assign(menu.current.style, { left: body.left + 'px',
          bottom: innerHeight - body.top + 4 + 'px', width: body.width + 'px' });
      }}><WorkspaceIcon name="addContext" /></button>
    <div id={id} ref={menu} popover="auto" role="dialog" aria-label="Add files and more"
      className="yard-source-add-panel rounded-3xl bg-surface text-default"
      onToggle={event => setOpen(event.newState === 'open')}>
      <p>Add</p>
      <button type="button" onClick={() => { menu.current?.hidePopover(); picker.current?.click(); }}>
        <Paperclip size={14} aria-hidden="true" /><span>Files and folders</span>
      </button>
    </div>
    <input type="file" hidden multiple ref={picker} onChange={selected} />
  </>;
}

export function AttachmentCard({ name, file, remove, preview = true, hostId = 'local' }: {
  name: string; file?: PromptAttachment; hostId?: string; preview?: boolean; remove?(): void;
}) {
  if (file?.image && preview) return <ImageAttachment file={file} hostId={hostId} remove={remove} />;
  return <span className="yard-source-attachment">
    <span className="yard-source-attachment-surface bg-surface-secondary rounded-2xl">
      <span className="yard-source-attachment-preview">
        {file ? <FileText size={28} aria-hidden="true" /> : <LoaderCircle size={20} role="status" aria-label="Uploading" />}
      </span>
      <span className="yard-source-attachment-name bg-surface"><Paperclip size={12} aria-hidden="true" /><span>{name}</span></span>
      {file && <a className="yard-source-attachment-download" href={attachmentUrl(hostId, file.path, true, name)} download={name} aria-label={name} />}
    </span>
    {remove && <button type="button" className="yard-source-attachment-remove" aria-label={'Remove ' + name}
      onClick={remove}><X size={12} aria-hidden="true" /></button>}
  </span>;
}

function ImageAttachment({ file, hostId, remove }: { file: PromptAttachment; hostId: string; remove?(): void }) {
  const [open, setOpen] = useState(false);
  return <div className="yard-source-image-attachment relative flex size-30.5 shrink-0 group/composer-attachment">
    <button type="button" className="composer-attachment-surface relative block size-full cursor-interaction overflow-hidden rounded-2xl bg-surface-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      aria-label={file.name} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <img src={attachmentUrl(hostId, file.path)} alt="User attachment" className="size-full object-cover" />
      <span aria-hidden="true" className="composer-attachment-surface pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-border ring-inset group-hover/composer-attachment:bg-text/5 group-hover/composer-attachment:ring-border-strong group-has-focus-visible/composer-attachment:ring-border-strong" />
    </button>
    {remove && <button type="button"
      className="absolute -top-0.5 -right-0.5 flex size-4 cursor-interaction items-center justify-center rounded-full bg-primary-solid text-primary-solid shadow-sm pointer-events-none opacity-0 ring-2 ring-surface group-focus-visible/composer-attachment:pointer-events-auto group-focus-visible/composer-attachment:opacity-100 group-hover/composer-attachment:pointer-events-auto group-hover/composer-attachment:opacity-100 group-has-focus-visible/composer-attachment:pointer-events-auto group-has-focus-visible/composer-attachment:opacity-100 hover:bg-text/80 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
      aria-label={'Remove ' + file.name} onClick={remove}>
      <WorkspaceIcon name="closeSmall" size={12} />
    </button>}
    {open && <ImagePreview image={file} hostId={hostId} close={() => setOpen(false)} />}
  </div>;
}
