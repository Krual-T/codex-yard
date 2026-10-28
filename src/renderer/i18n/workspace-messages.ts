export const workspaceMessageKeys = [
  'New conversation', 'Waiting for approval', 'Waiting for input', 'In progress', 'System error', 'New chat in',
  'Archived', 'Retry project lookup', 'Searching conversations...', 'Loading conversations...', 'No matching conversations',
  'No conversations yet', 'Show recent chats', 'Some legacy project associations are unresolved. Original records are retained.',
] as const;

export type WorkspaceMessageKey = typeof workspaceMessageKeys[number];
type Catalog = Partial<Record<WorkspaceMessageKey, string>>;

const simplified: Catalog = {
  'New conversation': '新对话', 'Waiting for approval': '等待审批', 'Waiting for input': '等待输入', 'In progress': '进行中',
  'System error': '系统错误', 'New chat in': '在此项目新建对话：', 'Archived': '已归档', 'Retry project lookup': '重试项目查询',
  'Searching conversations...': '正在搜索对话...', 'Loading conversations...': '正在加载对话...', 'No matching conversations': '没有匹配的对话',
  'No conversations yet': '暂无对话', 'Show recent chats': '显示最近对话',
  'Some legacy project associations are unresolved. Original records are retained.': '部分旧项目归属尚无法确定，原记录已保留。',
};
const traditional: Catalog = {
  'New conversation': '新對話', 'Waiting for approval': '等待核准', 'Waiting for input': '等待輸入', 'In progress': '進行中',
  'System error': '系統錯誤', 'New chat in': '在此專案新增對話：', 'Archived': '已封存', 'Retry project lookup': '重試專案查詢',
  'Searching conversations...': '正在搜尋對話...', 'Loading conversations...': '正在載入對話...', 'No matching conversations': '沒有符合的對話',
  'No conversations yet': '尚無對話', 'Show recent chats': '顯示最近對話',
  'Some legacy project associations are unresolved. Original records are retained.': '部分舊專案歸屬尚無法確定，原始記錄已保留。',
};
const japanese: Catalog = {
  'New conversation': '新しい会話', 'Waiting for approval': '承認待ち', 'Waiting for input': '入力待ち', 'In progress': '進行中',
  'System error': 'システムエラー', 'New chat in': '新しいチャット：', 'Archived': 'アーカイブ済み', 'Retry project lookup': 'プロジェクト検索を再試行',
  'Searching conversations...': '会話を検索中...', 'Loading conversations...': '会話を読み込み中...', 'No matching conversations': '一致する会話がありません',
  'No conversations yet': '会話はまだありません', 'Show recent chats': '最近のチャットを表示',
  'Some legacy project associations are unresolved. Original records are retained.': '以前のプロジェクトの関連付けを特定できません。元の記録は保持されています。',
};
const korean: Catalog = {
  'New conversation': '새 대화', 'Waiting for approval': '승인 대기 중', 'Waiting for input': '입력 대기 중', 'In progress': '진행 중',
  'System error': '시스템 오류', 'New chat in': '새 대화:', 'Archived': '보관됨', 'Retry project lookup': '프로젝트 조회 다시 시도',
  'Searching conversations...': '대화 검색 중...', 'Loading conversations...': '대화 불러오는 중...', 'No matching conversations': '일치하는 대화가 없습니다',
  'No conversations yet': '아직 대화가 없습니다', 'Show recent chats': '최근 대화 표시',
  'Some legacy project associations are unresolved. Original records are retained.': '일부 이전 프로젝트 연결을 확인할 수 없습니다. 원본 기록은 보존됩니다.',
};
const spanish: Catalog = {
  'New conversation': 'Nueva conversación', 'Waiting for approval': 'Esperando aprobación', 'Waiting for input': 'Esperando respuesta', 'In progress': 'En curso',
  'System error': 'Error del sistema', 'New chat in': 'Nuevo chat en', 'Archived': 'Archivados', 'Retry project lookup': 'Reintentar búsqueda de proyectos',
  'Searching conversations...': 'Buscando conversaciones...', 'Loading conversations...': 'Cargando conversaciones...', 'No matching conversations': 'No hay conversaciones coincidentes',
  'No conversations yet': 'Aún no hay conversaciones', 'Show recent chats': 'Mostrar chats recientes',
  'Some legacy project associations are unresolved. Original records are retained.': 'No se pueden determinar algunas asociaciones de proyectos antiguos. Se conservan los registros originales.',
};
const french: Catalog = {
  'New conversation': 'Nouvelle conversation', 'Waiting for approval': 'En attente d’approbation', 'Waiting for input': 'En attente de réponse', 'In progress': 'En cours',
  'System error': 'Erreur système', 'New chat in': 'Nouvelle conversation dans', 'Archived': 'Archivées', 'Retry project lookup': 'Réessayer la recherche des projets',
  'Searching conversations...': 'Recherche des conversations...', 'Loading conversations...': 'Chargement des conversations...', 'No matching conversations': 'Aucune conversation correspondante',
  'No conversations yet': 'Aucune conversation pour le moment', 'Show recent chats': 'Afficher les conversations récentes',
  'Some legacy project associations are unresolved. Original records are retained.': 'Certaines anciennes associations de projets restent inconnues. Les données d’origine sont conservées.',
};
const german: Catalog = {
  'New conversation': 'Neue Unterhaltung', 'Waiting for approval': 'Wartet auf Genehmigung', 'Waiting for input': 'Wartet auf Eingabe', 'In progress': 'In Bearbeitung',
  'System error': 'Systemfehler', 'New chat in': 'Neuer Chat in', 'Archived': 'Archiviert', 'Retry project lookup': 'Projektsuche erneut versuchen',
  'Searching conversations...': 'Unterhaltungen werden gesucht...', 'Loading conversations...': 'Unterhaltungen werden geladen...', 'No matching conversations': 'Keine passenden Unterhaltungen',
  'No conversations yet': 'Noch keine Unterhaltungen', 'Show recent chats': 'Letzte Chats anzeigen',
  'Some legacy project associations are unresolved. Original records are retained.': 'Einige frühere Projektzuordnungen sind ungeklärt. Die ursprünglichen Daten bleiben erhalten.',
};
const portuguese: Catalog = {
  'New conversation': 'Nova conversa', 'Waiting for approval': 'Aguardando aprovação', 'Waiting for input': 'Aguardando resposta', 'In progress': 'Em andamento',
  'System error': 'Erro do sistema', 'New chat in': 'Nova conversa em', 'Archived': 'Arquivadas', 'Retry project lookup': 'Tentar buscar projetos novamente',
  'Searching conversations...': 'Buscando conversas...', 'Loading conversations...': 'Carregando conversas...', 'No matching conversations': 'Nenhuma conversa correspondente',
  'No conversations yet': 'Ainda não há conversas', 'Show recent chats': 'Mostrar conversas recentes',
  'Some legacy project associations are unresolved. Original records are retained.': 'Algumas associações de projetos antigos não foram identificadas. Os registros originais foram preservados.',
};

export function workspaceMessagesFor(locale: string): Catalog {
  const language = locale.toLowerCase().split('-')[0];
  if (language === 'zh') return /(?:^|-)(?:tw|hk|mo|hant)(?:-|$)/i.test(locale) ? traditional : simplified;
  return ({ ja: japanese, ko: korean, es: spanish, fr: french, de: german, pt: portuguese } as Record<string, Catalog>)[language!] ?? {};
}
