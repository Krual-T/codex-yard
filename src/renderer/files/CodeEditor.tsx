import { useEffect, useRef, useState } from 'react';
import { Redo2, Search, Undo2 } from 'lucide-react';
import { history, historyKeymap, defaultKeymap, indentWithTab, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { defaultHighlightStyle, bracketMatching, HighlightStyle, indentOnInput, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { closeSearchPanel, getSearchQuery, openSearchPanel, search, searchKeymap, searchPanelOpen, SearchQuery, setSearchQuery } from '@codemirror/search';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { editorText } from './file-service.ts';
import { fileFormat, fileText } from './editor-format.ts';
import { panelError, usePanelText } from '../panels/panel-i18n.ts';

interface Props {
  path: string;
  text: string;
  theme: 'light' | 'dark';
  visible: boolean;
  readOnly: boolean;
  wrap?: boolean;
  location?: { line: number; column?: number; id: number };
  findRequest?: number;
  onFindRequestConsumed?(id: number): void;
  onChange(text: string): void;
  onSave(): void;
}

const darkColors: Record<string, string> = {
  '#404740': '#b5c3bc', '#708': '#d6a5e8', '#219': '#c6b7ff', '#164': '#a8d5aa', '#a11': '#f2ada0',
  '#e40': '#f8b584', '#00f': '#a8c7ff', '#30a': '#c8b4f3', '#085': '#8fd5b4', '#167': '#92d1dc',
  '#256': '#9dcddd', '#00c': '#a8c7ff', '#940': '#d6bd86', '#f00': '#ffaaa0',
};
const darkHighlightStyle = HighlightStyle.define(defaultHighlightStyle.specs.map(spec => {
  const color = typeof spec.color === 'string' ? darkColors[spec.color] : undefined;
  return color ? { ...spec, color } : spec;
}));
const editorTheme = (dark: boolean) => [EditorView.theme({}, { dark }), syntaxHighlighting(dark ? darkHighlightStyle : defaultHighlightStyle)];
const searchPhrases = ['Find', 'Replace', 'next', 'previous', 'all', 'match case', 'regexp', 'by word', 'replace',
  'replace all', 'close', 'Go to line', 'go', 'current match', 'on line', 'replaced match on line $', 'replaced $ matches'];

export function CodeEditor(props: Props) {
  const t = usePanelText();
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const initial = useRef(props.text);
  const navigated = useRef<number | undefined>(undefined);
  const language = useRef(new Compartment());
  const editable = useRef(new Compartment());
  const theme = useRef(new Compartment());
  const wrapping = useRef(new Compartment());
  const phrases = useRef(new Compartment());
  const attributes = useRef(new Compartment());
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });
  const [languageError, setLanguageError] = useState('');
  const [findStatus, setFindStatus] = useState<string>();

  useEffect(() => {
    if (!container.current) return;
    const format = fileFormat(initial.current);
    let countTimer: number | undefined;
    let lastSearch: EditorState | undefined;
    const countMatches = (state: EditorState) => {
      const open = searchPanelOpen(state), query = getSearchQuery(state), selection = state.selection.main;
      if (lastSearch && lastSearch.doc === state.doc && searchPanelOpen(lastSearch) === open &&
          getSearchQuery(lastSearch).eq(query) && lastSearch.selection.main.eq(selection)) return;
      lastSearch = state;
      window.clearTimeout(countTimer);
      if (!open) { setFindStatus(undefined); return; }
      if (!query.valid) { setFindStatus('0 / 0'); return; }
      setFindStatus('Searching...');
      const cursor = query.getCursor(state);
      let total = 0, current = 0;
      const step = () => {
        for (let index = 0; index < 4096; index++) {
          const match = cursor.next();
          if (match.done) { setFindStatus(`${current} / ${total}`); return; }
          total++;
          if (match.value.from === selection.from && match.value.to === selection.to) current = total;
        }
        countTimer = window.setTimeout(step, 0);
      };
      countTimer = window.setTimeout(step, 0);
    };
    const instance = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: editorText(initial.current),
        extensions: [
          format.extension, history(), lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
          bracketMatching(), indentOnInput(), search({ top: true }),
          EditorState.allowMultipleSelections.of(true),
          attributes.current.of(EditorView.contentAttributes.of({ 'aria-label': t('File: {path}', { path: props.path }), role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false' })),
          phrases.current.of(EditorState.phrases.of(Object.fromEntries(searchPhrases.map(key => [key, t(key)])))),
          editable.current.of([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]),
          theme.current.of(editorTheme(props.theme === 'dark')),
          wrapping.current.of(props.wrap ? EditorView.lineWrapping : []),
          language.current.of([]),
          Prec.highest(keymap.of([
            { key: 'Mod-s', scope: 'editor search-panel', run: () => { callbacks.current.onSave(); return true; }, preventDefault: true },
            { key: 'Mod-h', scope: 'editor search-panel', run: editor => {
              openSearchPanel(editor);
              editor.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]')?.focus();
              return true;
            }, preventDefault: true },
          ])),
          keymap.of([...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
          EditorView.updateListener.of(update => {
            if (update.docChanged) callbacks.current.onChange(fileText(update.state, format.field));
            countMatches(update.state);
            const next = { undo: undoDepth(update.state) > 0, redo: redoDepth(update.state) > 0 };
            setHistoryState(previous => previous.undo === next.undo && previous.redo === next.redo ? previous : next);
          }),
        ],
      }),
    });
    view.current = instance;
    let cancelled = false;
    const description = LanguageDescription.matchFilename(languages, props.path.split('/').at(-1) ?? props.path);
    if (description) void description.load().then(support => {
      if (!cancelled) instance.dispatch({ effects: language.current.reconfigure(support) });
    }).catch(error => {
      if (!cancelled) setLanguageError(`Language support unavailable: ${error instanceof Error ? error.message : String(error)}`);
    });
    return () => { cancelled = true; window.clearTimeout(countTimer); view.current = null; instance.destroy(); };
    // Each mounted editor belongs to one file and load id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]) });
  }, [props.readOnly]);
  useEffect(() => {
    view.current?.dispatch({ effects: theme.current.reconfigure(editorTheme(props.theme === 'dark')) });
  }, [props.theme]);
  useEffect(() => {
    view.current?.dispatch({ effects: wrapping.current.reconfigure(props.wrap ? EditorView.lineWrapping : []) });
  }, [props.wrap]);
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const open = searchPanelOpen(instance.state);
    const stateQuery = getSearchQuery(instance.state);
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const searchPanel = instance.dom.querySelector('.cm-search');
    const input = focused instanceof HTMLInputElement && searchPanel?.contains(focused) ? focused : null;
    const field = (name: string) => searchPanel?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    const query = searchPanel ? new SearchQuery({
      search: field('search')?.value ?? stateQuery.search, replace: field('replace')?.value ?? stateQuery.replace,
      caseSensitive: field('case')?.checked ?? stateQuery.caseSensitive, regexp: field('re')?.checked ?? stateQuery.regexp,
      wholeWord: field('word')?.checked ?? stateQuery.wholeWord, literal: stateQuery.literal, test: stateQuery.test,
    }) : stateQuery;
    const name = focused && searchPanel?.contains(focused) ? focused.getAttribute('name') : null;
    const start = input?.selectionStart, end = input?.selectionEnd;
    if (open) closeSearchPanel(instance);
    instance.dispatch({ effects: [
      phrases.current.reconfigure(EditorState.phrases.of(Object.fromEntries(searchPhrases.map(key => [key, t(key)])))),
      attributes.current.reconfigure(EditorView.contentAttributes.of({ 'aria-label': t('File: {path}', { path: props.path }), role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false' })),
    ] });
    if (open) {
      openSearchPanel(instance);
      instance.dispatch({ effects: setSearchQuery.of(query) });
      const replacement = name ? instance.dom.querySelector<HTMLElement>(`.cm-search [name="${CSS.escape(name)}"]`) : null;
      if (replacement) {
        replacement.focus();
        if (replacement instanceof HTMLInputElement && start != null && end != null) replacement.setSelectionRange(start, end);
      } else if (focused?.isConnected) focused.focus({ preventScroll: true });
    }
  }, [props.path, t]);
  useEffect(() => { if (props.visible) view.current?.requestMeasure(); }, [props.visible]);
  useEffect(() => {
    const instance = view.current;
    if (!instance || !props.visible || !props.location || navigated.current === props.location.id) return;
    navigated.current = props.location.id;
    const line = instance.state.doc.line(Math.min(instance.state.doc.lines, Math.max(1, Math.floor(props.location.line) || 1)));
    const offset = Math.min(line.to, line.from + Math.max(0, (Math.floor(props.location.column ?? 1) || 1) - 1));
    instance.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: 'center' }) });
    instance.focus();
    // A location id represents a new navigation request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.location?.id, props.visible]);
  useEffect(() => {
    if (props.findRequest === undefined || !view.current || !props.visible) return;
    openSearchPanel(view.current);
    props.onFindRequestConsumed?.(props.findRequest);
  }, [props.findRequest, props.onFindRequestConsumed, props.visible]);

  return <div className="yard-text-viewer">
    <div className="yard-file-find">
      <button type="button" className="yard-panel-icon" title={t('Undo')} aria-label={t('Undo')} disabled={props.readOnly || !historyState.undo}
        onClick={() => { if (view.current) { undo(view.current); view.current.focus(); } }}><Undo2 /></button>
      <button type="button" className="yard-panel-icon" title={t('Redo')} aria-label={t('Redo')} disabled={props.readOnly || !historyState.redo}
        onClick={() => { if (view.current) { redo(view.current); view.current.focus(); } }}><Redo2 /></button>
      <button type="button" className="yard-panel-icon" title={t('Find and replace')} aria-label={t('Find in file')}
        onClick={() => { if (view.current) openSearchPanel(view.current); }}><Search /></button>
      {findStatus !== undefined ? <span role="status" aria-live="polite">{t(findStatus)}</span> : null}
      {languageError ? <span role="status">{panelError(t, languageError)}</span> : null}
    </div>
    <div ref={container} className="yard-file-editor" />
  </div>;
}
