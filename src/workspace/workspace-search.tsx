import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { workspaceThreadRoute } from '../native/history-startup.ts';
import type { StartupSidebar } from '../native/startup-sidebar.ts';
import { sidebar } from './host.ts';

type Option = {
  key: string;
  label: string;
  detail?: string;
  icon?: ReactNode;
  run(): void;
};
export type WorkspaceCommand = Option & { group: string };
type Source = { hostId: string; data?: StartupSidebar; label?: string };

export function WorkspaceSearch({ sources, commands, select, close }: {
  sources: Source[];
  commands: WorkspaceCommand[];
  select(route: string): void;
  close(): void;
}) {
  const title = useId();
  const suggestions = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState('');
  const [selectedKey, setSelectedKey] = useState<string>();
  const query = value.trim();
  const scope = JSON.stringify(sources.map(source => source.hostId));
  const [results, setResults] = useState<{ query: string; scope: string; replies: Map<string, StartupSidebar | null> }>();

  useLayoutEffect(() => {
    const modal = dialog.current!;
    modal.showModal();
    return () => modal.close();
  }, []);
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    function record(hostId: string, result: StartupSidebar | null) {
      if (cancelled) return;
      setResults(previous => ({ query, scope, replies: new Map(previous?.query === query && previous.scope === scope ?
        previous.replies : undefined).set(hostId, result) }));
    }
    const timer = window.setTimeout(() => {
      for (const hostId of JSON.parse(scope) as string[]) {
        void sidebar(hostId, query).then(result => record(hostId, result), () => record(hostId, null));
      }
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, scope]);

  const settled = !!query && results?.query === query && results.scope === scope ? results.replies : undefined;
  const normalized = query.toLocaleLowerCase();
  const chats = new Map<string, Option>();
  for (const source of sources) {
    const add = (data: StartupSidebar | null | undefined, match: boolean) => {
      if (!data) return;
      for (const thread of data.threads) {
        if (match && !thread.title.toLocaleLowerCase().includes(normalized)) continue;
        const key = workspaceThreadRoute(source.hostId, thread.id);
        const project = data.projects.find(row => row.id === thread.projectId)?.label;
        chats.set(key, { key, label: thread.title, detail: [source.label, project].filter(Boolean).join(' · '), run: () => select(key) });
      }
    };
    add(source.data, true);
    if (query) add(settled?.get(source.hostId), false);
  }
  const groups = new Map<string, Option[]>([['Chats', [...chats.values()].slice(0, query ? 100 : 9)]]);
  for (const command of commands) {
    if (!command.label.toLocaleLowerCase().includes(normalized)) continue;
    const group = groups.get(command.group);
    if (group) group.push(command); else groups.set(command.group, [command]);
  }
  const options = [...groups.values()].flat();
  const selected = options.findIndex(option => option.key === selectedKey);
  const index = selected >= 0 ? selected : 0;
  const busy = !!query && (settled?.size ?? 0) < sources.length;
  const failed = !!settled && [...settled.values()].some(result => result === null);
  function dismiss() { dialog.current?.close(); close(); }
  function run(option: Option) { dismiss(); option.run(); }

  return createPortal(<dialog ref={dialog} className="yard-source-search-dialog bg-surface text-default"
    aria-labelledby={title} onCancel={event => { event.preventDefault(); dismiss(); }}
    onClick={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <h2 id={title} className="sr-only">Command menu</h2>
    <input autoFocus autoComplete="off" spellCheck={false} maxLength={240} placeholder="Search chats"
      role="combobox" aria-label="Command menu" aria-expanded="true"
      aria-autocomplete="list" aria-controls={suggestions} aria-activedescendant={options.length ? suggestions + '-' + index : undefined}
      value={value} onChange={event => { setSelectedKey(undefined); setValue(event.currentTarget.value); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || !options.length) return;
        if (event.key === 'Enter') {
          event.preventDefault(); run(options[index]!);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
          setSelectedKey(options[next]!.key);
          document.getElementById(suggestions + '-' + next)?.scrollIntoView({ block: 'nearest' });
        }
      }} />
    <div id={suggestions} role="listbox" aria-label="Suggestions" aria-busy={busy}>
      {[...groups].map(([group, entries]) => entries.length ? <div key={group} role="group" aria-label={group}>
        <div className="yard-source-search-heading" aria-hidden="true">{group}</div>
        {entries.map(option => {
          const at = options.indexOf(option);
          return <div key={option.key} role="option" id={suggestions + '-' + at}
            aria-selected={at === index} onPointerMove={() => setSelectedKey(option.key)} onClick={() => run(option)}>
            <span className="yard-source-search-option-icon" aria-hidden="true">{option.icon}</span>
            <span>{option.label}</span>{option.detail && <small>{option.detail}</small>}
          </div>;
        })}
      </div> : null)}
    </div>
    {(busy || failed || !options.length) && <p className="yard-source-search-status" role="status">
      {busy ? 'Searching…' : failed ? 'Could not search every host.' : 'No results'}
    </p>}
  </dialog>, document.body);
}
