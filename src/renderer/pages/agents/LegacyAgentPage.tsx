import { ArrowLeft } from 'lucide-react';
import { translateKnown, useI18n } from '../../i18n/index.tsx';
import './workspace-agent.css';

export function LegacyAgentPage({ agentId, onBack }: { agentId: string; onBack(): void }) {
  const { t } = useI18n();
  const text = (value: string) => translateKnown(t, value);
  const href = `https://chatgpt.com/agents/a/${encodeURIComponent(agentId)}`;
  return <main className="yard-agent-page"><div className="yard-agent-content">
    <header className="yard-agent-toolbar"><button className="yard-agent-icon-button" type="button" aria-label={t('Back')} title={t('Back')} onClick={onBack}><ArrowLeft size={17} /></button></header>
    <section className="yard-agent-legacy"><h1>{text('Open this agent in ChatGPT')}</h1><p>{text("Workspace Agents isn't available in Codex yet")}</p>
      <a href={href} target="_blank" rel="noopener noreferrer">{text('Open in ChatGPT')}</a></section>
  </div></main>;
}
