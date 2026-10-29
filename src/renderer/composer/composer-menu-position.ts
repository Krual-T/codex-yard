export function positionComposerMenu(menu: HTMLDetailsElement): void {
  if (!menu.open || !menu.isConnected) {
    menu.removeAttribute('data-positioned');
    return;
  }
  const panel = menu.querySelector<HTMLElement>(':scope > .standalone-composer__menu-panel');
  const anchor = menu.classList.contains('standalone-composer__add')
    ? menu.closest<HTMLElement>('.standalone-composer__editor') : menu.querySelector<HTMLElement>(':scope > summary');
  if (!panel || !anchor) return;
  const margin = 8, gap = 5;
  const bounds = anchor.getBoundingClientRect();
  if (menu.classList.contains('standalone-composer__add')) {
    panel.style.setProperty('--composer-menu-width', `${Math.min(bounds.width, innerWidth - margin * 2)}px`);
  }
  const size = panel.getBoundingClientRect();
  const desiredLeft = menu.classList.contains('standalone-composer__model') ? bounds.right - size.width : bounds.left;
  const left = Math.max(margin, Math.min(desiredLeft, innerWidth - size.width - margin));
  const above = bounds.top - size.height - gap, below = bounds.bottom + gap;
  const preferBelow = !!menu.closest('.standalone-composer__target');
  const top = preferBelow && below + size.height <= innerHeight - margin ? below
    : above >= margin ? above : below + size.height <= innerHeight - margin ? below
    : Math.max(margin, Math.min(above, innerHeight - size.height - margin));
  panel.style.setProperty('--composer-menu-left', `${left}px`);
  panel.style.setProperty('--composer-menu-top', `${top}px`);
  menu.setAttribute('data-positioned', '');
}
