/** Install local controls without replacing the authored variant DOM. */
export function installVisualizationCarousels(): () => void {
  const abort = new AbortController();
  const { signal } = abort;
  const style = document.createElement('style');
  style.textContent = `
    .viz-carousel { position: relative; min-width: 0; }
    .viz-carousel > [data-variant][hidden] { display: none !important; }
    .viz-carousel-controls { display: flex; justify-content: center; align-items: center; gap: 4px; margin-top: 12px; font: 13px system-ui, sans-serif; }
    .viz-carousel-controls button, .viz-carousel-picker > summary { color: var(--viz-text, inherit); background: var(--viz-panel, transparent); border: 1px solid var(--viz-border, #aaa); border-radius: 4px; min-height: 36px; cursor: pointer; }
    .viz-carousel-controls > button { width: 36px; display: grid; place-items: center; }
    .viz-carousel-chevron { width: 8px; height: 8px; border-top: 1.5px solid currentColor; border-right: 1.5px solid currentColor; transform: rotate(45deg); }
    .viz-carousel-previous .viz-carousel-chevron { transform: rotate(-135deg); }
    .viz-carousel-picker { position: relative; max-width: min(70%, 360px); }
    .viz-carousel-picker > summary { display: flex; align-items: center; gap: 8px; padding: 0 10px; list-style: none; overflow-wrap: anywhere; }
    .viz-carousel-picker > summary::-webkit-details-marker { display: none; }
    .viz-carousel-count { white-space: nowrap; color: var(--viz-muted, #666); }
    .viz-carousel-options { display: grid; gap: 2px; margin-top: 4px; }
    .viz-carousel-options button { text-align: left; padding: 6px 10px; overflow-wrap: anywhere; }
    .viz-carousel-options button[aria-current="true"] { font-weight: 600; }
    .viz-carousel-status { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @media (max-width: 600px) { .viz-carousel-controls button, .viz-carousel-picker > summary { min-height: 44px; } .viz-carousel-controls > button { width: 44px; } }
  `;
  document.head.append(style);
  const controlsAdded: HTMLElement[] = [];
  for (const root of document.querySelectorAll<HTMLElement>('.viz-carousel')) {
    const panels = Array.from(root.querySelectorAll<HTMLElement>(':scope > [data-variant]'));
    if (!panels.length) continue;
    root.setAttribute('role', 'group');
    panels.forEach(panel => {
      panel.setAttribute('role', 'group');
      if (!panel.hasAttribute('aria-label')) panel.setAttribute('aria-label', panel.dataset.variant ?? '');
    });
    if (panels.length === 1) {
      panels[0]!.hidden = false;
      root.dataset.activeVariant = panels[0]!.dataset.variant ?? '';
      continue;
    }
    const controls = document.createElement('div');
    controls.className = 'viz-carousel-controls';
    const makeArrow = (className: string, label: string) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = className; button.setAttribute('aria-label', label); button.title = label;
      const icon = document.createElement('span'); icon.className = 'viz-carousel-chevron'; icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
      return button;
    };
    const previous = makeArrow('viz-carousel-previous', root.dataset.previousLabel ?? 'Previous variant');
    const next = makeArrow('viz-carousel-next', root.dataset.nextLabel ?? 'Next variant');
    const picker = document.createElement('details'); picker.className = 'viz-carousel-picker';
    const summary = document.createElement('summary');
    const count = document.createElement('span'); count.className = 'viz-carousel-count';
    const name = document.createElement('span'); name.className = 'viz-carousel-name';
    const options = document.createElement('div'); options.className = 'viz-carousel-options';
    const status = document.createElement('span'); status.className = 'viz-carousel-status';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
    summary.append(count, name); picker.append(summary, options); controls.append(previous, picker, next); root.append(controls, status);
    controlsAdded.push(controls, status);
    let active = 0;
    const choices = panels.map((panel, index) => {
      const choice = document.createElement('button'); choice.type = 'button'; choice.textContent = panel.dataset.variant ?? '';
      choice.addEventListener('click', () => { select(index); summary.focus(); }, { signal });
      options.append(choice);
      return choice;
    });
    function select(index: number) {
      const changed = active !== index;
      active = index;
      panels.forEach((panel, position) => { panel.hidden = position !== active; choices[position]!.setAttribute('aria-current', String(position === active)); });
      const label = panels[active]!.dataset.variant ?? '';
      root.dataset.activeVariant = label;
      count.textContent = `${active + 1} / ${panels.length}`;
      name.textContent = label;
      picker.open = false;
      if (changed) status.textContent = `${count.textContent}: ${label}`;
    }
    previous.addEventListener('click', () => select((active + panels.length - 1) % panels.length), { signal });
    next.addEventListener('click', () => select((active + 1) % panels.length), { signal });
    picker.addEventListener('keydown', event => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape' && picker.open) { event.preventDefault(); picker.open = false; summary.focus(); return; }
      const index = choices.indexOf(document.activeElement as HTMLButtonElement);
      let destination: number;
      if (event.key === 'ArrowDown') destination = index < 0 ? active : (index + 1) % choices.length;
      else if (event.key === 'ArrowUp') destination = index < 0 ? active : (index + choices.length - 1) % choices.length;
      else if (picker.open && event.key === 'Home') destination = 0;
      else if (picker.open && event.key === 'End') destination = choices.length - 1;
      else return;
      event.preventDefault(); picker.open = true; choices[destination]!.focus();
    }, { signal });
    picker.addEventListener('focusout', event => { if (!picker.contains(event.relatedTarget as Node | null)) picker.open = false; }, { signal });
    document.addEventListener('pointerdown', event => { if (!picker.contains(event.target as Node | null)) picker.open = false; }, { signal });
    select(0);
  }
  return () => { abort.abort(); style.remove(); controlsAdded.forEach(element => element.remove()); };
}
