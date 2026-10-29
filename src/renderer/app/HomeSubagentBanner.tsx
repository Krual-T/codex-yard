import { X } from 'lucide-react';
import { useI18n } from '../i18n/index.tsx';
import './home-subagent-banner.css';

type Labels = readonly [title: string, body: string, tryNow: string, dismiss: string];
const english: Labels = ['Subagents in Codex',
  'Delegate work to subagents that work in parallel. Note: may increase token usage.', 'Try now', 'Dismiss subagent banner'];
const translations: Record<string, Labels> = {
  zh: ['Codex 中的子智能体', '将任务委派给并行运行的子智能体。注意：这可能会增加 Token 消耗量。', '立即试用', '关闭子智能体横幅'],
  'zh-Hant': ['Codex 中的子代理', '委派工作給可平行運作的子代理。注意：可能會增加 Token 用量。', '立即試用', '關閉子代理橫幅'],
  ja: ['Codex のサブエージェント', '並列で動作するサブエージェントに作業を委任します。注: トークン使用量が増えることがあります。', '今すぐ試す', 'サブエージェントのバナーを閉じる'],
  ko: ['Codex의 하위 에이전트', '병렬로 작업하는 하위 에이전트에 작업을 위임합니다. 참고: 토큰 사용량이 늘어날 수 있습니다.', '지금 사용해 보세요', '하위 에이전트 배너 닫기'],
  es: ['Subagentes en Codex', 'Delega trabajo a subagentes que trabajan en paralelo. Nota: puede aumentar el uso de tókenes.', 'Pruébalo ahora', 'Cerrar anuncio de subagente'],
  'es-419': ['Subagentes en Codex', 'Delega trabajo a subagentes que trabajan en paralelo. Nota: Puede aumentar el uso de tókenes.', 'Pruébalo ahora', 'Descartar el banner del subagente'],
  fr: ['Sous-agents dans Codex', 'Déléguez le travail à des sous-agents qui travaillent en parallèle. Remarque\u00a0: peut augmenter l’utilisation de jetons.', 'Essayer', 'Fermer la bannière des sous-agents'],
  de: ['Subagenten in Codex', 'Delegiere Aufgaben an parallel arbeitende Subagenten. Hinweis: Kann den Tokenverbrauch erhöhen.', 'Jetzt testen', 'Subagenten-Banner schließen'],
  pt: ['Subagentes no Codex', 'Delegue tarefas para subagentes que trabalham em paralelo. Atenção: isso pode aumentar o uso de tokens.', 'Experimente agora', 'Fechar banner de subagente'],
  'pt-PT': ['Subagentes no Codex', 'Delegue trabalho a subagentes que trabalham em paralelo. Nota: pode aumentar a utilização de tokens.', 'Experimente já', 'Fechar banner do subagente'],
};

/** The App owns the original feature gate, durable dismissal and guarded prefill. */
export function HomeSubagentBanner({ pending = false, onTryNow, onDismiss }: {
  pending?: boolean;
  onTryNow(): void;
  onDismiss(): void;
}) {
  const { locale } = useI18n();
  const language = locale.toLowerCase();
  const key = /^zh-(?:tw|hk|mo|hant)(?:-|$)/.test(language) ? 'zh-Hant'
    : language === 'pt-pt' ? 'pt-PT' : language === 'es-419' ? 'es-419' : language.split('-')[0]!;
  const [title, body, tryNow, dismiss] = translations[key] ?? english;
  return <div className="yard-home-subagents-inset">
    <section className="yard-home-subagents" aria-label={title}>
      <div className="yard-home-subagents__row">
        <div className="yard-home-subagents__content">
          <span className="yard-home-subagents__icon" aria-hidden="true">
            <svg viewBox="0 0 28 28" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="14" cy="9.5" r="3" /><circle cx="5" cy="10.5" r="2.5" /><circle cx="23" cy="10.5" r="2.5" />
              <path d="M8 21c0-3 2.7-5 6-5s6 2 6 5M1 20c0-2.5 1.8-4 4.2-4 .5 0 1 .1 1.5.3M27 20c0-2.5-1.8-4-4.2-4-.5 0-1 .1-1.5.3" />
            </svg>
          </span>
          <div className="yard-home-subagents__copy"><div className="yard-home-subagents__title">{title}</div>
            <div className="yard-home-subagents__body">{body}</div></div>
        </div>
        <div className="yard-home-subagents__actions">
          <button type="button" className="yard-home-subagents__try" disabled={pending} onClick={onTryNow}>{tryNow}</button>
          <button type="button" className="yard-home-subagents__dismiss" aria-label={dismiss} disabled={pending} onClick={onDismiss}><X size={16} aria-hidden="true" /></button>
        </div>
      </div>
    </section>
  </div>;
}
