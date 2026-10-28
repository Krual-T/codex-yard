/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type { ComponentType, FocusEvent, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import type { MessageDescriptor, SettingRowProps } from './section-types.ts';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type FontSizeKind = 'ui' | 'code';

export interface AppearanceControlMessages {
  theme: MessageDescriptor;
  themeSystem: MessageDescriptor;
  light: MessageDescriptor;
  dark: MessageDescriptor;
  uiFontSize: MessageDescriptor;
  codeFontSize: MessageDescriptor;
}

export interface AppearanceControlDependencies {
  useIntl: () => { formatMessage: (message: MessageDescriptor) => string };
  useThemeMode: () => AppearanceMode | null | undefined;
  useSaveThemeMode: () => (mode: AppearanceMode) => void;
  useFontSize: (kind: FontSizeKind) => number;
  useSaveFontSize: () => (kind: FontSizeKind, value: number) => void;
  isValidFontSize: (kind: FontSizeKind, value: number) => boolean;
  fontSizeLimits: { ui: { min: number; max: number }; code: { min: number; max: number } };
  messages: AppearanceControlMessages;
  FormattedMessage: ComponentType<MessageDescriptor>;
  Row: ComponentType<SettingRowProps>;
  Input: ComponentType<{
    variant: 'compact';
    type: 'number';
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    'aria-label': string;
    onPointerDown: (event: PointerEvent<HTMLInputElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLInputElement>) => void;
    onBlur: (event: FocusEvent<HTMLInputElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  }>;
  Tooltip: ComponentType<{ tooltipContent: string; children?: ReactNode }>;
  SystemLightPreview: ComponentType<{ className: string }>;
  SystemDarkPreview: ComponentType<{ className: string }>;
  LightPreview: ComponentType<{ className: string }>;
  DarkPreview: ComponentType<{ className: string }>;
  classNames: (...classes: string[]) => string;
}

/** yc/kc/Ac and jc/Mc: settings still read and write the original atoms. */
export function createAppearanceControlComponents(React: typeof import('react'), deps: AppearanceControlDependencies) {
  const { messages, FormattedMessage, Row, Input, Tooltip, SystemLightPreview, SystemDarkPreview,
    LightPreview, DarkPreview } = deps;

  function ModePreview({ mode, selected }: { mode: AppearanceMode; selected: boolean }) {
    const Preview = mode === 'dark' ? DarkPreview : LightPreview;
    return <span aria-hidden="true" className="relative isolate block aspect-4/3 w-full overflow-hidden rounded-lg text-info peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
      {mode === 'system' ? <span className="grid size-full grid-cols-2">
        <SystemLightPreview className="block size-full" /><SystemDarkPreview className="block size-full" />
      </span> : <Preview className="block size-full" />}
      <span className={deps.classNames('absolute inset-0 rounded-lg border-2', selected ? 'border-ring' : 'border-default group-hover:border-strong')} />
    </span>;
  }

  function ModeOption({ ariaLabel, mode, selected, onSelect }: {
    ariaLabel: string; mode: AppearanceMode; selected: boolean; onSelect: () => void;
  }) {
    return <Tooltip tooltipContent={ariaLabel}><label className="group flex min-w-0 cursor-interaction flex-col items-center gap-1.5 text-center">
      <input aria-label={ariaLabel} checked={selected} className="peer sr-only" name="appearance-theme" onChange={onSelect} type="radio" />
      <ModePreview mode={mode} selected={selected} />
    </label></Tooltip>;
  }

  function Mode() {
    const saveMode = deps.useSaveThemeMode();
    const intl = deps.useIntl();
    const mode = deps.useThemeMode() ?? 'system';
    const options: { id: AppearanceMode; label: MessageDescriptor }[] = [
      { id: 'system', label: messages.themeSystem },
      { id: 'light', label: messages.light },
      { id: 'dark', label: messages.dark },
    ];
    return <div aria-label={intl.formatMessage(messages.theme)} className="grid w-68 max-w-full grid-cols-3 gap-4" role="radiogroup">
      {options.map(option => <ModeOption key={option.id} ariaLabel={intl.formatMessage(option.label)} mode={option.id}
        selected={mode === option.id} onSelect={() => { saveMode(option.id); }} />)}
    </div>;
  }

  function createFontSizeRow(kind: FontSizeKind) {
    return function FontSizeRow() {
      const saveFontSize = deps.useSaveFontSize();
      const intl = deps.useIntl();
      const size = deps.useFontSize(kind);
      const pointerStartValue = React.useRef<string | null>(null);
      const isUi = kind === 'ui';
      const commit = (input: HTMLInputElement) => {
        const value = Number.parseFloat(input.value);
        if (!deps.isValidFontSize(kind, value)) { input.value = String(size); return; }
        input.value = String(value);
        if (value !== size) saveFontSize(kind, value);
      };
      const ariaLabel = intl.formatMessage(isUi
        ? { id: 'settings.general.appearance.sansFontSize', defaultMessage: 'Sans font size', description: 'Label for sans font size setting' }
        : { id: 'settings.general.appearance.codeFontSize', defaultMessage: 'Code font size', description: 'Label for code font size setting' });
      const units = intl.formatMessage(isUi
        ? { id: 'settings.general.appearance.sansFontSize.units', defaultMessage: 'px', description: 'Unit label for sans font size setting' }
        : { id: 'settings.general.appearance.codeFontSize.units', defaultMessage: 'px', description: 'Unit label for code font size setting' });
      return <Row label={<FormattedMessage {...(isUi ? messages.uiFontSize : messages.codeFontSize)} />}
        description={isUi
          ? <FormattedMessage id="settings.appearance.uiFontSize.description" defaultMessage="Adjust the base size used for ChatGPT" description="Description for the base size of text in the ChatGPT interface" />
          : <FormattedMessage id="settings.general.appearance.codeFontSize.row.description" defaultMessage="Adjust the base size used for code across chats and diffs" description="Description for code font size controls" />}
        control={<div className="flex items-center gap-2">
          <div className="w-16"><Input key={size} variant="compact" type="number" min={deps.fontSizeLimits[kind].min}
            max={deps.fontSizeLimits[kind].max} step={1} defaultValue={size} aria-label={ariaLabel}
            onPointerDown={event => { pointerStartValue.current = event.currentTarget.value; }}
            onPointerUp={event => {
              if (pointerStartValue.current != null && pointerStartValue.current !== event.currentTarget.value) commit(event.currentTarget);
              pointerStartValue.current = null;
            }}
            onBlur={event => { commit(event.currentTarget); }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(event.currentTarget); } }} />
          </div><span className="text-sm text-secondary">{units}</span>
        </div>} />;
    };
  }

  return { Mode, UiFontSize: createFontSizeRow('ui'), CodeFontSize: createFontSizeRow('code') };
}
