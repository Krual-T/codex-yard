import type { ComponentType, ReactNode } from 'react';
import { Activity, Bell, BookOpen, Bookmark, Briefcase, Calendar, CheckSquare, Clipboard, CodeSquare, CreditCard, FileText, FlaskConical, Folder, Heart, Home, Image, Lightbulb, Map, MapPin, MessageCircle, Monitor, Newspaper, Pencil, Search, ShoppingBag, ShoppingCart, Sparkles, Star, Table, Tag, ThumbsDown, ThumbsUp, Users, Video, Zap } from 'lucide-react';
import type { AgentIconValue } from './agent-model.ts';

const icons: Record<string, ComponentType<{ size?: number; 'aria-hidden'?: boolean }>> = {
  sparkle: Sparkles, star: Star, business: Briefcase, 'lightning-bolt': Zap, lightbulb: Lightbulb,
  health: Activity, 'heart-chat': Heart, chat: MessageCircle, bell: Bell, home: Home, bookmarks: Bookmark,
  pencil: Pencil, flask: FlaskConical, 'bar-chart': Activity, 'table-2x2': Table, 'file-code-square': CodeSquare,
  calendar: Calendar, members: Users, briefcase: Briefcase, 'deep-research': Search, stuff: Folder,
  study: BookOpen, newspaper: Newspaper, 'product-tag': Tag, creditcard: CreditCard, cart: ShoppingCart,
  warning: Bell, folder: Folder, 'connect-screen': Monitor, 'task-clock': Calendar, 'checkbox-checked': CheckSquare,
  'thumb-up': ThumbsUp, 'thumb-down': ThumbsDown, 'image-caption-simple': Image, 'image-square': Image,
  video: Video, map: Map, mappin: MapPin, 'shopping-bag': ShoppingBag, clipboard: Clipboard,
  'american-football': FileText,
};
export const agentIconNames = Object.keys(icons);
export const agentIconColors = ['text', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
const colors: Record<string, string> = { text: 'var(--yard-fg)', red: '#cf4545', orange: '#b86712', yellow: '#9c7900', green: '#258455', blue: '#3476c6', purple: '#8053bc', pink: '#ba4e87', teal: '#16817d', black: 'var(--yard-fg)', white: 'var(--yard-fg)' };

export function AgentIcon({ icon, size = 32, renderIcon }: { icon: AgentIconValue | null; size?: number; renderIcon?: (icon: AgentIconValue | null, size: number) => ReactNode }) {
  if (renderIcon) return <>{renderIcon(icon, size)}</>;
  const name = icon?.name.trim().replaceAll(':', '').replaceAll('_', '-').replaceAll(' ', '-') ?? '';
  const Glyph = icons[name] ?? Sparkles;
  return <span className="yard-agent-glyph" style={{ color: colors[icon?.color ?? 'text'] ?? 'var(--yard-fg)' }} title={name && !icons[name] ? `Icon: ${icon?.name}` : undefined}>
    <Glyph size={size} aria-hidden={true} />
  </span>;
}

export function AgentIconPicker({ icon, disabled, onChange, renderIcon }: { icon: AgentIconValue; disabled: boolean; onChange: (icon: AgentIconValue) => void; renderIcon?: (icon: AgentIconValue | null, size: number) => ReactNode }) {
  return <details className="yard-agent-picker">
    <summary aria-label="Choose agent icon" title="Choose agent icon" aria-disabled={disabled} onClick={event => { if (disabled) event.preventDefault(); }}>
      <AgentIcon icon={icon} size={30} renderIcon={renderIcon} />
    </summary>
    <div className="yard-agent-picker-panel">
      <div className="yard-agent-swatches" aria-label="Icon color">{agentIconColors.map(color => <button key={color} type="button" aria-label={`${color} icon color`} aria-pressed={icon.color === color} title={color} disabled={disabled}
        style={{ background: colors[color] }} onClick={() => onChange({ ...icon, color })} />)}</div>
      <div className="yard-agent-icon-grid" aria-label="Agent icons">{agentIconNames.map(name => <button key={name} type="button" aria-label={`${name} icon`} aria-pressed={icon.name === name} title={name} disabled={disabled}
        onClick={() => onChange({ ...icon, name })}><AgentIcon icon={{ ...icon, name }} size={20} renderIcon={renderIcon} /></button>)}</div>
    </div>
  </details>;
}
