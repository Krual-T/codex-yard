import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Bot, ChevronDown, File, Globe, ListChecks, LoaderCircle, MessageSquare, PanelRightClose, Paperclip, Plus, Square, Target, Terminal, Wrench } from 'lucide-react';
import { useI18n } from '../i18n/index.tsx';
import type { AutomationEntry } from '../pages/automations/model.ts';
import type { SideChatDraftIdentity } from '../side-chat/browser-authority.ts';
import type { ConversationSnapshot } from './conversation-sessions.ts';
import { projectThreadSummary } from './thread-summary-model.ts';
import type { ThreadSummaryPlan, ThreadSummarySource } from './thread-summary-model.ts';
import './thread-summary-panel.css';

export interface ThreadSummarySideChat {
  identity: SideChatDraftIdentity;
  title: string;
  kind: 'active' | 'recoverable';
  working?: boolean;
}
export type ThreadSummaryOutput = { id: string; label: string; kind: 'file'; path: string }
  | { id: string; label: string; kind: 'link'; url: string };
export interface ThreadSummaryOutputs {
  entries: readonly ThreadSummaryOutput[];
  loading: boolean;
  error?: string | null;
  /** The parent has explicitly requested the original empty outputs view. */
  showWhenEmpty?: boolean;
}
export interface ThreadSummarySubagent { threadId: string; label: string; working?: boolean; detail?: string }
export interface ThreadSummaryProcess { id: string; command: string; working?: boolean }
export interface ThreadSummaryCreatedChat { threadId: string; label: string }
export interface ThreadSummaryAutomation { entry: AutomationEntry; kind: 'goal' | 'scheduled'; detail?: string }

export interface ThreadSummaryPanelProps {
  hostId: string;
  threadId: string;
  snapshot: ConversationSnapshot;
  sideChats: readonly ThreadSummarySideChat[];
  sideChatsLoading?: boolean;
  sideChatsError?: string | null;
  onRetrySideChats?(): void | Promise<void>;
  onShowSideChat(identity: SideChatDraftIdentity): void | Promise<void>;
  onRestoreSideChat(identity: SideChatDraftIdentity): void | Promise<void>;
  /** Only automations actually associated with this conversation belong here. */
  automations?: readonly ThreadSummaryAutomation[];
  onOpenAutomation?(automation: ThreadSummaryAutomation): void | Promise<void>;
  onOpenPlan?(plan: ThreadSummaryPlan): void | Promise<void>;
  onOpenFile?(location: { hostId: string; cwd: string; path: string }): void | Promise<void>;
  onOpenWebSearch?(source: Extract<ThreadSummarySource, { kind: 'web' }>): void | Promise<void>;
  onOpenToolSource?(source: Extract<ThreadSummarySource, { kind: 'tool' }>): void | Promise<void>;
  /** Projectless conversations show the original empty Sources section. */
  projectless?: boolean;
  onAddSource?(): void | Promise<void>;
  outputs?: ThreadSummaryOutputs;
  onOpenOutput?(output: ThreadSummaryOutput): void | Promise<void>;
  onRetryOutputs?(): void | Promise<void>;
  subagents?: readonly ThreadSummarySubagent[];
  onOpenSubagent?(agent: ThreadSummarySubagent): void | Promise<void>;
  backgroundProcesses?: readonly ThreadSummaryProcess[];
  onOpenBackgroundProcess?(process: ThreadSummaryProcess): void | Promise<void>;
  onStopBackgroundProcesses?(): void | Promise<void>;
  createdChats?: readonly ThreadSummaryCreatedChat[];
  onOpenCreatedChat?(chat: ThreadSummaryCreatedChat): void | Promise<void>;
  onClose?(): void;
}

type Labels = typeof en;
const en = { summary: 'Summary', close: 'Close summary', sources: 'Sources', sideChats: 'Side chats', outputs: 'Outputs',
  emptyOutputs: 'No outputs yet', loadingOutputs: 'Loading outputs…', outputError: 'Could not load all outputs',
  web: 'Web search', subagents: 'Subagents', processes: 'Background processes', process: 'Background terminal',
  stop: 'Stop all background terminals', createdChats: 'Created chats', working: 'is working',
  addSource: 'Add sources', emptySources: 'Attach files or connect apps', more: 'View all', less: 'Show less',
  actionError: 'Could not complete action', scheduled: 'Scheduled',
  sideChatsLoading: 'Loading side chats…', sideChatsError: 'Could not load side chats' } as const;
const translations: Record<string, Partial<Record<keyof Labels, string>>> = {
  zh: { summary: '摘要', close: '关闭摘要', sources: '来源', sideChats: '侧聊', outputs: '输出', emptyOutputs: '暂无输出',
    loadingOutputs: '正在加载输出…', outputError: '无法加载全部输出', web: '网页搜索', subagents: '子代理', processes: '后台进程',
    process: '后台终端', stop: '停止所有后台终端', createdChats: '创建的对话', working: '正在工作', addSource: '添加来源',
    emptySources: '附加文件或连接应用', more: '查看全部', less: '收起', actionError: '无法完成操作', scheduled: '计划任务',
    sideChatsLoading: '正在加载侧聊…', sideChatsError: '无法加载侧聊' },
  ja: { summary: '概要', close: '概要を閉じる', sources: 'ソース', sideChats: 'サイドチャット', outputs: '出力', emptyOutputs: '出力はまだありません',
    loadingOutputs: '出力を読み込み中…', outputError: '一部の出力を読み込めません', web: 'ウェブ検索', subagents: 'サブエージェント',
    processes: 'バックグラウンドプロセス', process: 'バックグラウンドターミナル', stop: 'すべてのターミナルを停止', createdChats: '作成されたチャット',
    working: '作業中', addSource: 'ソースを追加', emptySources: 'ファイルを添付またはアプリを接続', more: 'すべて表示', less: '折りたたむ',
    actionError: '操作を完了できません', scheduled: 'スケジュール', sideChatsLoading: 'サイドチャットを読み込み中…', sideChatsError: 'サイドチャットを読み込めません' },
  ko: { summary: '요약', close: '요약 닫기', sources: '소스', sideChats: '사이드 채팅', outputs: '출력', emptyOutputs: '아직 출력이 없습니다',
    loadingOutputs: '출력 불러오는 중…', outputError: '일부 출력을 불러오지 못했습니다', web: '웹 검색', subagents: '하위 에이전트',
    processes: '백그라운드 프로세스', process: '백그라운드 터미널', stop: '모든 백그라운드 터미널 중지', createdChats: '생성된 채팅', working: '작업 중',
    addSource: '소스 추가', emptySources: '파일을 첨부하거나 앱 연결', more: '모두 보기', less: '접기', actionError: '작업을 완료하지 못했습니다', scheduled: '예약됨',
    sideChatsLoading: '사이드 채팅 불러오는 중…', sideChatsError: '사이드 채팅을 불러오지 못했습니다' },
  es: { summary: 'Resumen', close: 'Cerrar resumen', sources: 'Fuentes', sideChats: 'Chats laterales', outputs: 'Resultados',
    emptyOutputs: 'Todavía no hay resultados', loadingOutputs: 'Cargando resultados…', outputError: 'No se pudieron cargar todos los resultados',
    web: 'Búsqueda web', subagents: 'Subagentes', processes: 'Procesos en segundo plano', process: 'Terminal en segundo plano',
    stop: 'Detener terminales en segundo plano', createdChats: 'Chats creados', working: 'trabajando', addSource: 'Añadir fuentes',
    emptySources: 'Adjunta archivos o conecta aplicaciones', more: 'Ver todo', less: 'Mostrar menos', actionError: 'No se pudo completar la acción', scheduled: 'Programado',
    sideChatsLoading: 'Cargando chats laterales…', sideChatsError: 'No se pudieron cargar los chats laterales' },
  fr: { summary: 'Résumé', close: 'Fermer le résumé', sources: 'Sources', sideChats: 'Conversations latérales', outputs: 'Résultats',
    emptyOutputs: 'Aucun résultat pour le moment', loadingOutputs: 'Chargement des résultats…', outputError: 'Impossible de charger tous les résultats',
    web: 'Recherche web', subagents: 'Sous-agents', processes: 'Processus en arrière-plan', process: 'Terminal en arrière-plan',
    stop: 'Arrêter les terminaux en arrière-plan', createdChats: 'Conversations créées', working: 'en cours', addSource: 'Ajouter des sources',
    emptySources: 'Joindre des fichiers ou connecter des applications', more: 'Tout voir', less: 'Réduire', actionError: 'Action impossible', scheduled: 'Planifié',
    sideChatsLoading: 'Chargement des conversations latérales…', sideChatsError: 'Impossible de charger les conversations latérales' },
  de: { summary: 'Übersicht', close: 'Übersicht schließen', sources: 'Quellen', sideChats: 'Seitenchats', outputs: 'Ergebnisse',
    emptyOutputs: 'Noch keine Ergebnisse', loadingOutputs: 'Ergebnisse werden geladen…', outputError: 'Nicht alle Ergebnisse konnten geladen werden',
    web: 'Websuche', subagents: 'Unteragenten', processes: 'Hintergrundprozesse', process: 'Hintergrundterminal',
    stop: 'Alle Hintergrundterminals stoppen', createdChats: 'Erstellte Chats', working: 'arbeitet', addSource: 'Quellen hinzufügen',
    emptySources: 'Dateien anhängen oder Apps verbinden', more: 'Alle anzeigen', less: 'Weniger anzeigen', actionError: 'Aktion fehlgeschlagen', scheduled: 'Geplant',
    sideChatsLoading: 'Seitenchats werden geladen…', sideChatsError: 'Seitenchats konnten nicht geladen werden' },
  pt: { summary: 'Resumo', close: 'Fechar resumo', sources: 'Fontes', sideChats: 'Conversas laterais', outputs: 'Resultados',
    emptyOutputs: 'Ainda não há resultados', loadingOutputs: 'Carregando resultados…', outputError: 'Não foi possível carregar todos os resultados',
    web: 'Pesquisa na web', subagents: 'Subagentes', processes: 'Processos em segundo plano', process: 'Terminal em segundo plano',
    stop: 'Parar terminais em segundo plano', createdChats: 'Conversas criadas', working: 'trabalhando', addSource: 'Adicionar fontes',
    emptySources: 'Anexe arquivos ou conecte aplicativos', more: 'Ver tudo', less: 'Mostrar menos', actionError: 'Não foi possível concluir a ação', scheduled: 'Agendado',
    sideChatsLoading: 'Carregando conversas laterais…', sideChatsError: 'Não foi possível carregar as conversas laterais' },
};
const traditionalChinese: Partial<Record<keyof Labels, string>> = { summary: '摘要', close: '關閉摘要', sources: '來源', sideChats: '側聊',
  outputs: '輸出', emptyOutputs: '尚無輸出', loadingOutputs: '正在載入輸出…', outputError: '無法載入全部輸出', web: '網頁搜尋',
  subagents: '子代理', processes: '背景程序', process: '背景終端機', stop: '停止所有背景終端機', createdChats: '建立的對話',
  working: '正在工作', addSource: '新增來源', emptySources: '附加檔案或連接應用程式', more: '查看全部', less: '收合',
  actionError: '無法完成操作', scheduled: '排程', sideChatsLoading: '正在載入側聊…', sideChatsError: '無法載入側聊' };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function Section({ title, count, children, after }: { title: string; count?: number; children: ReactNode; after?: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return <section className="yard-thread-summary__section">
    <div className="yard-thread-summary__heading">
      <button type="button" className="yard-thread-summary__toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <ChevronDown size={14} aria-hidden="true" className={expanded ? '' : 'yard-thread-summary__collapsed'} />
        <span>{title}</span>{count !== undefined && <span className="yard-thread-summary__count">{count}</span>}
      </button>{after}
    </div>
    {expanded && <div className="yard-thread-summary__list">{children}</div>}
  </section>;
}

function Row({ icon, label, detail, action, working }: { icon: ReactNode; label: string; detail?: string; action?: () => void; working?: string }) {
  const content = <>{icon}<span className="yard-thread-summary__label" title={label}>{label}</span>
    {working && <span className="yard-thread-summary__working">{working}</span>}{detail && <span className="yard-thread-summary__detail">{detail}</span>}</>;
  return action ? <button type="button" className="yard-thread-summary__row" onClick={action}>{content}</button>
    : <div className="yard-thread-summary__row">{content}</div>;
}

/** The parent owns visibility, route changes, and all action authority. */
export function ThreadSummaryPanel(props: ThreadSummaryPanelProps) {
  return <SummaryContents key={JSON.stringify([props.hostId, props.threadId])} {...props} />;
}

function SummaryContents(props: ThreadSummaryPanelProps) {
  const { hostId, threadId, snapshot } = props;
  const { t, locale } = useI18n();
  const language = locale.toLowerCase();
  const labels = { ...en, ...translations[language.split('-')[0] ?? ''],
    ...(/^(zh-(tw|hk|mo)|zh-hant)(-|$)/.test(language) ? traditionalChinese : {}) };
  const thread = snapshot.thread?.id === threadId ? snapshot.thread : null;
  const { plan, sources } = useMemo(() => projectThreadSummary(thread, hostId), [thread, hostId]);
  const byDraft = new Map<string, ThreadSummarySideChat>();
  for (const item of props.sideChats) {
    if (item.identity.hostId !== hostId || item.identity.parentThreadId !== threadId) continue;
    const key = JSON.stringify([item.identity.draftId, item.identity.prepareId]);
    if (!byDraft.has(key) || item.kind === 'active') byDraft.set(key, item);
  }
  const sideChats = [...byDraft.values()];
  const [actionError, setActionError] = useState('');
  const [showAllSources, setShowAllSources] = useState(false);
  const [showAllOutputs, setShowAllOutputs] = useState(false);
  const actionSequence = useRef(0), mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; actionSequence.current++; };
  }, []);
  const perform = (callback: () => void | Promise<void>) => {
    const current = ++actionSequence.current;
    try {
      setActionError('');
      void Promise.resolve(callback()).catch(error => { if (mounted.current && actionSequence.current === current) setActionError(errorText(error)); });
    } catch (error) { setActionError(errorText(error)); }
  };
  const outputs = props.outputs;
  const goals = props.automations?.filter(item => item.kind === 'goal') ?? [];
  const scheduled = props.automations?.filter(item => item.kind === 'scheduled') ?? [];
  const automationRow = (automation: ThreadSummaryAutomation) => <Row
    key={JSON.stringify([automation.entry.sourceKey, automation.entry.item.id])}
    icon={<Target size={16} aria-hidden="true" />} label={automation.entry.item.name} detail={automation.detail}
    action={props.onOpenAutomation ? () => perform(() => props.onOpenAutomation!(automation)) : undefined} />;
  const visibleOutputs = showAllOutputs ? outputs?.entries ?? [] : outputs?.entries.slice(0, 3) ?? [];
  const visibleSources = showAllSources ? sources : sources.slice(0, 3);
  const more = (open: boolean, toggle: () => void) => <button className="yard-thread-summary__more" type="button" onClick={toggle}>{open ? labels.less : labels.more}</button>;
  return <aside className="yard-thread-summary" aria-label={labels.summary}>
    <header className="yard-thread-summary__header"><span>{labels.summary}</span>{props.onClose &&
      <button type="button" aria-label={labels.close} title={labels.close} onClick={props.onClose}><PanelRightClose size={16} aria-hidden="true" /></button>}</header>
    <div className="yard-thread-summary__content">
      {actionError && <div className="yard-thread-summary__error" role="alert">{labels.actionError}: {actionError}</div>}
      {goals.length > 0 && <Section title={t('Goal')} count={goals.length}>{goals.map(automationRow)}</Section>}
      {scheduled.length > 0 && <Section title={labels.scheduled} count={scheduled.length}>{scheduled.map(automationRow)}</Section>}
      {plan && <Section title={t('Plan')}><Row icon={<ListChecks size={16} aria-hidden="true" />}
        label={plan.text.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim() || t('Plan')}
        action={props.onOpenPlan ? () => perform(() => props.onOpenPlan!(plan)) : undefined} /></Section>}
      {outputs && (outputs.showWhenEmpty || outputs.loading || outputs.error || outputs.entries.length > 0) && <Section title={labels.outputs} count={outputs.entries.length}>
        {visibleOutputs.map(output => <Row key={output.id} icon={<File size={16} aria-hidden="true" />} label={output.label}
          action={props.onOpenOutput ? () => perform(() => props.onOpenOutput!(output)) : undefined} />)}
        {outputs.entries.length > 3 && more(showAllOutputs, () => setShowAllOutputs(!showAllOutputs))}
        {outputs.loading && <div role="status" className="yard-thread-summary__muted">{labels.loadingOutputs}</div>}
        {outputs.error && <div role="alert" className="yard-thread-summary__error">{labels.outputError}: {outputs.error}
          {props.onRetryOutputs && <button type="button" onClick={() => perform(props.onRetryOutputs!)}>{t('Retry')}</button>}</div>}
        {!outputs.loading && !outputs.error && outputs.entries.length === 0 && <div className="yard-thread-summary__muted">{labels.emptyOutputs}</div>}
      </Section>}
      {(sideChats.length > 0 || props.sideChatsLoading || props.sideChatsError) && <Section title={labels.sideChats} count={sideChats.length}>{sideChats.map(item =>
        <Row key={JSON.stringify([item.identity.draftId, item.identity.prepareId])} icon={item.working
          ? <LoaderCircle size={16} aria-label={labels.working} className="yard-thread-summary__spinner" />
          : <MessageSquare size={16} aria-hidden="true" />} label={item.title} action={() => perform(() => item.kind === 'active'
            ? props.onShowSideChat(item.identity) : props.onRestoreSideChat(item.identity))} />)}
        {props.sideChatsLoading && <div role="status" className="yard-thread-summary__muted">{labels.sideChatsLoading}</div>}
        {props.sideChatsError && <div role="alert" className="yard-thread-summary__error">{labels.sideChatsError}: {props.sideChatsError}
          {props.onRetrySideChats && <button type="button" onClick={() => perform(props.onRetrySideChats!)}>{t('Retry')}</button>}</div>}
      </Section>}
      {!!props.createdChats?.length && <Section title={labels.createdChats} count={props.createdChats.length}>{props.createdChats.map(chat =>
        <Row key={chat.threadId} icon={<MessageSquare size={16} aria-hidden="true" />} label={chat.label}
          action={props.onOpenCreatedChat ? () => perform(() => props.onOpenCreatedChat!(chat)) : undefined} />)}</Section>}
      {!!props.subagents?.length && <Section title={labels.subagents} count={props.subagents.length}>{props.subagents.map(agent =>
        <Row key={agent.threadId} icon={<Bot size={16} aria-hidden="true" />} label={agent.label} detail={agent.detail} working={agent.working ? labels.working : undefined}
          action={props.onOpenSubagent ? () => perform(() => props.onOpenSubagent!(agent)) : undefined} />)}</Section>}
      {!!props.backgroundProcesses?.length && <Section title={labels.processes} count={props.backgroundProcesses.length}
        after={props.onStopBackgroundProcesses && <button type="button" className="yard-thread-summary__action" aria-label={labels.stop} title={labels.stop}
          onClick={() => perform(props.onStopBackgroundProcesses!)}><Square size={14} aria-hidden="true" /></button>}>
        {props.backgroundProcesses.map(process => <Row key={process.id} icon={<Terminal size={16} aria-hidden="true" />} label={process.command || labels.process}
          working={process.working ? labels.working : undefined} action={props.onOpenBackgroundProcess ? () => perform(() => props.onOpenBackgroundProcess!(process)) : undefined} />)}
      </Section>}
      {(sources.length > 0 || props.projectless) && <Section title={labels.sources} count={sources.length}
        after={props.onAddSource && <button className="yard-thread-summary__action" type="button" title={labels.addSource} aria-label={labels.addSource} onClick={() => perform(props.onAddSource!)}><Plus size={15} aria-hidden="true" /></button>}>
        {visibleSources.map(source => source.kind === 'file' ? <Row key={`file:${source.path}`} icon={<File size={16} aria-hidden="true" />} label={source.label}
          action={props.onOpenFile && thread ? () => perform(() => props.onOpenFile!({ hostId, cwd: thread.cwd, path: source.path })) : undefined} />
          : source.kind === 'web' ? <Row key="web" icon={<Globe size={16} aria-hidden="true" />} label={labels.web}
            action={props.onOpenWebSearch ? () => perform(() => props.onOpenWebSearch!(source)) : undefined} />
            : <Row key={`tool:${source.server}`} icon={<Wrench size={16} aria-hidden="true" />} label={source.server}
              action={props.onOpenToolSource ? () => perform(() => props.onOpenToolSource!(source)) : undefined} />)}
        {sources.length === 0 && <Row icon={<Paperclip size={16} aria-hidden="true" />} label={labels.emptySources}
          action={props.onAddSource ? () => perform(props.onAddSource!) : undefined} />}
        {sources.length > 3 && more(showAllSources, () => setShowAllSources(!showAllSources))}
      </Section>}
    </div>
  </aside>;
}
