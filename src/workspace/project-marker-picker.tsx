import { CarFront, CircleHelp, Clock3, ConciergeBell, Flag, Hand, Heart, Lightbulb, PawPrint, Search, Smile } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { defaultProjectAppearance, projectColors, projectIconCatalog, type ProjectAppearance, type ProjectIcon } from '../native/project-appearance.ts';
import { ProjectMarker } from './project-marker.tsx';

declare const __yardProjectEmojiUrl: string;

type Emoji = [symbol: string, keywords: string[]];
type EmojiGroup = [name: string, entries: Emoji[]];
let cachedEmojis: Promise<EmojiGroup[]> | undefined;
function loadEmojis() {
  return cachedEmojis ??= fetch(__yardProjectEmojiUrl).then(response => {
    if (!response.ok) throw new Error('Could not load symbols');
    return response.json() as Promise<EmojiGroup[]>;
  }).catch(error => { cachedEmojis = undefined; throw error; });
}

const iconOptions = Object.entries(projectIconCatalog) as [ProjectIcon, readonly [label: string, svg: string | null]][];
const suggested: Emoji[] = [['😄', ['grinning face with smiling eyes']], ['👍', ['thumbs up']], ['❤️', ['red heart']],
  ['🎉', ['party popper']], ['🚀', ['rocket']], ['👀', ['face', 'eyes']], ['🙏', ['folded hands']], ['🔥', ['flame']]];
const categoryIcons = [Clock3, Smile, Hand, PawPrint, ConciergeBell, CarFront, CircleHelp, Lightbulb, Heart, Flag];

export function ProjectMarkerPicker({ name, appearance, change, disabled, closedFolder }: {
  name: string; appearance?: ProjectAppearance | null; change(appearance: ProjectAppearance | null): Promise<void>;
  disabled?: boolean; closedFolder?: boolean;
}) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const writes = useRef(Promise.resolve());
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'emoji' | 'icon'>('icon');
  const [query, setQuery] = useState('');
  const [emojis, setEmojis] = useState<EmojiGroup[]>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState<ProjectAppearance | null>();
  const [writeError, setWriteError] = useState<string>();
  const [activeCategory, setActiveCategory] = useState('Suggested');
  const displayed = draft === undefined ? appearance : draft;
  const selected = displayed ?? defaultProjectAppearance;
  const label = 'Search ' + (kind === 'icon' ? 'icons' : 'emojis');
  useLayoutEffect(() => {
    if (!open) return;
    const button = anchor.current!, popup = panel.current!;
    const position = () => {
      const { x, y, height, width } = button.getBoundingClientRect();
      const { height: h, width: w } = popup.getBoundingClientRect();
      popup.style.left = Math.max(8, Math.min(x + (width - w) / 2, innerWidth - w - 8)) + 'px';
      popup.style.top = Math.max(8, Math.min(y + height + 6 + h <= innerHeight - 8 ? y + height + 6
        : y - h - 6 >= 8 ? y - h - 6 : y + height + 6, innerHeight - h - 8)) + 'px';
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(popup);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    search.current?.focus({ preventScroll: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open || kind !== 'emoji' || emojis) return;
    let live = true;
    void loadEmojis().then(next => { if (live) setEmojis(next); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open, kind, emojis, retry]);

  function update(next: ProjectAppearance | null) {
    setDraft(next);
    setWriteError(undefined);
    const current = ++generation.current;
    writes.current = writes.current.then(() => change(next)).then(() => {
      if (current === generation.current) setDraft(undefined);
    }, error => {
      if (current !== generation.current) return;
      setDraft(undefined);
      setWriteError(error instanceof Error ? error.message : String(error));
    });
  }
  function switchKind(next: typeof kind) {
    setKind(next);
    setQuery('');
  }
  function gridKeys(event: KeyboardEvent) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key];
    if (step === undefined && event.key !== 'Home' && event.key !== 'End') return;
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="gridcell"] button')];
    if (!options.length) return;
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0 && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const next = event.key === 'Home' || current < 0 ? 0 : event.key === 'End' ? options.length - 1
      : Math.max(0, Math.min(options.length - 1, current + (step ?? 0)));
    options[next]?.focus();
  }
  const needle = query.trim().toLowerCase();
  const icons = open && kind === 'icon' ? iconOptions.filter(([id, [title]]) => !needle || title.toLowerCase().includes(needle) || id.includes(needle)) : [];
  const emojiResults = open && kind === 'emoji' && emojis ? needle
    ? [['Search results', emojis.flatMap(([, entries]) => entries.filter(([symbol, names]) =>
      symbol.includes(needle) || needle.split(/\s+/).every(word => names.some(part => part.toLowerCase().includes(word)))))] as EmojiGroup]
    : [['Suggested', suggested] as EmojiGroup, ...emojis] : [];
  const count = kind === 'icon' ? icons.length : emojiResults.reduce((sum, [, values]) => sum + values.length, 0);
  const iconRows = Array.from({ length: Math.ceil(icons.length / 8) }, (_, index) => icons.slice(index * 8, index * 8 + 8));
  return <>
    <button type="button" ref={anchor} className="yard-project-marker-trigger" title="Change marker" aria-label={'Change marker for ' + name}
      aria-haspopup="dialog" aria-controls={id} aria-expanded={open} popoverTarget={id} disabled={disabled} onClick={() => {
        if (!panel.current?.matches(':popover-open')) {
          setKind(selected.marker.kind);
          setQuery('');
        }
      }}><ProjectMarker appearance={displayed} variant={closedFolder ? 'closed' : undefined} /></button>
    <div id={id} ref={panel} role="dialog" aria-label="Project marker" className="yard-project-marker-picker" popover="auto"
      onToggle={event => setOpen(event.currentTarget.matches(':popover-open'))} onKeyDown={gridKeys}>
      {open && <>
        <div className="yard-project-marker-header">
          <div role="group" aria-label="Symbol type">
            <button type="button" aria-pressed={kind === 'emoji'} onClick={() => switchKind('emoji')}>Emoji</button>
            <button type="button" aria-pressed={kind === 'icon'} onClick={() => switchKind('icon')}>Icons</button>
          </div>
          {displayed && <button type="button" title="Clear" onClick={() => update(null)}>Clear</button>}
        </div>
        <input type="search" ref={search} aria-label={label} placeholder={label} value={query} onChange={event => setQuery(event.currentTarget.value)} />
        {kind === 'icon' && <div className="yard-project-colors" role="group" aria-label="Icon colors">
          {projectColors.map(color => {
            const name = 'Use ' + (color === 'black' ? 'Default' : color[0]!.toUpperCase() + color.slice(1));
            return <button type="button" key={color} title={name} aria-label={name} data-marker-color={color}
              aria-pressed={selected.color === color} onClick={() => update({ ...selected, color })}><span /></button>;
          })}
        </div>}
        {kind === 'emoji' && !needle && emojis && <div className="yard-project-emoji-categories" role="group" aria-label="Emoji categories">
          {emojiResults.map(([category], index) => {
            const Icon = categoryIcons[index] ?? Flag;
            return <button type="button" key={category} title={category} aria-label={category}
              aria-pressed={category === activeCategory} onClick={() => {
                setActiveCategory(category);
                const scroll = panel.current?.querySelector<HTMLElement>('.yard-project-emoji-scroll');
                const target = [...scroll?.querySelectorAll<HTMLElement>('[role="rowgroup"]') ?? []]
                  .find(group => group.getAttribute('aria-label') === category);
                if (scroll && target) scroll.scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
              }}><Icon size={14} aria-hidden="true" /></button>;
          })}
        </div>}
        <span className="sr-only" role="status">{count} {kind === 'icon' ? 'icons' : 'emoji'}</span>
        {kind === 'icon' ? iconRows.length ? <div role="grid" aria-label="Icons" className="yard-project-symbol-grid">
          {iconRows.map((row, i) => <div role="row" key={i}>
            {row.map(([icon, [title]]) => <div role="gridcell" key={icon} aria-label={title}>
              <button type="button" title={title} aria-label={title} aria-pressed={selected.marker.kind === 'icon' && selected.marker.icon === icon}
                onClick={() => update({ ...selected, marker: { kind: 'icon', icon } })}>
                <ProjectMarker appearance={{ color: selected.color, marker: { kind: 'icon', icon } }} size={20} variant="picker" />
              </button>
            </div>)}
          </div>)}
        </div> : <p className="yard-project-symbol-empty"><Search size={14} aria-hidden="true" /> No icons found</p>
          : emojis ? count ? <div className="yard-project-emoji-scroll" role="grid" aria-label="Emojis">
            {emojiResults.filter(([, entries]) => entries.length).map(([group, entries]) => <div role="rowgroup" aria-label={group} key={group}>
              <div className="yard-project-emoji-heading" aria-hidden="true">{group}</div>
              {Array.from({ length: Math.ceil(entries.length / 8) }, (_, i) => <div role="row" key={i}>
                {entries.slice(i * 8, i * 8 + 8).map(([emoji, names], j) => {
                  const title = names.at(-1) ?? emoji;
                  return <div role="gridcell" key={emoji + j} aria-label={title}>
                    <button type="button" title={title} aria-label={title} aria-pressed={selected.marker.kind === 'emoji' && selected.marker.emoji === emoji}
                      onClick={() => update({ ...selected, marker: { kind: 'emoji', emoji } })}>{emoji}</button>
                  </div>;
                })}
              </div>)}
            </div>)}
          </div> : <p className="yard-project-symbol-empty">No emojis found</p>
            : failed ? <button type="button" role="alert" onClick={() => { setFailed(false); setRetry(n => n + 1); }}>Could not load symbols · Retry</button>
              : <p className="yard-project-symbol-empty" role="status">Loading symbols…</p>}
        {writeError && <p role="alert">{writeError}</p>}
      </>}
    </div>
  </>;
}
