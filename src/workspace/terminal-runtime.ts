import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export function mountTerminal(container: HTMLElement) {
  function theme() {
    const { backgroundColor, color } = getComputedStyle(container);
    return { background: backgroundColor, foreground: color, cursor: color, selectionBackground: '#4080ff55' };
  }
  const terminal = new Terminal({ fontFamily: getComputedStyle(container).fontFamily, fontSize: 13,
    theme: theme(), disableStdin: true, cursorBlink: true });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(container);
  const html = new MutationObserver(() => { terminal.options.theme = theme(); });
  html.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  fit.fit();
  return {
    size: () => ({ cols: terminal.cols, rows: terminal.rows }),
    fit: () => fit.fit(),
    onResize: terminal.onResize,
    onInput: terminal.onData,
    write: (data: string) => terminal.write(data),
    focus: () => terminal.focus(),
    setReady: (ready: boolean) => { terminal.options.disableStdin = !ready; },
    close() { html.disconnect(); terminal.dispose(); },
  };
}
