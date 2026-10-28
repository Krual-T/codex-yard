/** @jsxRuntime classic */
/** @jsx React.createElement */
import type { ComponentType, ReactNode } from 'react';
import type { MessageDescriptor, SettingRowProps, ToggleProps } from './section-types.ts';

export type ReducedMotionPreference = 'system' | 'on' | 'off';
export type DiffMarkerStyle = 'color' | 'symbols';

interface SelectionOption<Id extends string> {
  id: Id;
  label: ReactNode;
  ariaLabel: string;
}

interface SelectionProps<Id extends string> {
  selectedId: Id;
  onSelect: (id: Id) => void;
  options: SelectionOption<Id>[];
}

export interface AppearancePreferenceMessages {
  reduceMotion: MessageDescriptor;
  reducedMotionSystem: MessageDescriptor;
  on: MessageDescriptor;
  off: MessageDescriptor;
  diffMarkers: MessageDescriptor;
  color: MessageDescriptor;
  plusMinus: MessageDescriptor;
  pointerCursors: MessageDescriptor;
  fontSmoothing: MessageDescriptor;
}

export interface AppearancePreferenceScope {
  setReducedMotion: (value: ReducedMotionPreference) => void;
  setDiffMarkerStyle: (value: DiffMarkerStyle) => void;
  setPointerCursors: (value: boolean) => Promise<unknown>;
  setFontSmoothing: (value: boolean) => void;
  toast: { danger: (message: ReactNode, options: { errorAnalytics: { toastId: string } }) => void };
}

export interface AppearancePreferenceDependencies {
  useScope: () => AppearancePreferenceScope;
  useIntl: () => { formatMessage: (message: MessageDescriptor) => string };
  useReducedMotion: () => ReducedMotionPreference;
  useDiffMarkerStyle: () => DiffMarkerStyle;
  usePointerCursors: () => boolean | null | undefined;
  usePlatform: () => { platform: string };
  useFontSmoothing: () => boolean;
  messages: AppearancePreferenceMessages;
  FormattedMessage: ComponentType<MessageDescriptor>;
  Row: ComponentType<SettingRowProps>;
  MotionSelection: ComponentType<SelectionProps<ReducedMotionPreference>>;
  DiffSelection: ComponentType<SelectionProps<DiffMarkerStyle>>;
  Toggle: ComponentType<ToggleProps>;
}

/** Ec, Tc, bc and Nc: the scope adapters retain the original setting atoms. */
export function createAppearancePreferenceRows(React: typeof import('react'), deps: AppearancePreferenceDependencies) {
  const { messages, FormattedMessage, Row, MotionSelection, DiffSelection, Toggle } = deps;

  function ReducedMotion() {
    const scope = deps.useScope();
    const intl = deps.useIntl();
    const selected = deps.useReducedMotion();
    return <Row label={<FormattedMessage {...messages.reduceMotion} />}
      description={<FormattedMessage id="settings.general.appearance.reducedMotion.description" defaultMessage="Reduce animations or match your system" description="Description for the reduced motion appearance setting" />}
      control={<MotionSelection selectedId={selected} onSelect={value => { scope.setReducedMotion(value); }} options={[
        { id: 'system', label: <FormattedMessage {...messages.reducedMotionSystem} />, ariaLabel: intl.formatMessage(messages.reducedMotionSystem) },
        { id: 'on', label: <FormattedMessage {...messages.on} />, ariaLabel: intl.formatMessage(messages.on) },
        { id: 'off', label: <FormattedMessage {...messages.off} />, ariaLabel: intl.formatMessage(messages.off) },
      ]} />} />;
  }

  function DiffMarkers() {
    const scope = deps.useScope();
    const intl = deps.useIntl();
    const selected = deps.useDiffMarkerStyle();
    return <Row className="gap-6" label={<FormattedMessage {...messages.diffMarkers} />}
      description={<FormattedMessage id="settings.general.appearance.diffMarkerStyle.description" defaultMessage="Show changes using colors or +/− markers" description="Description for the diff marker style setting" />}
      control={<DiffSelection selectedId={selected} onSelect={value => { scope.setDiffMarkerStyle(value); }} options={[
        { id: 'color', label: <FormattedMessage {...messages.color} />, ariaLabel: intl.formatMessage({ id: 'settings.general.appearance.diffMarkerStyle.color.ariaLabel', defaultMessage: 'Color diff markers', description: 'Aria label for the color diff marker option' }) },
        { id: 'symbols', label: <FormattedMessage {...messages.plusMinus} />, ariaLabel: intl.formatMessage({ id: 'settings.general.appearance.diffMarkerStyle.symbols.ariaLabel', defaultMessage: 'Plus / minus diff markers', description: 'Aria label for the plus and minus diff marker option' }) },
      ]} />} />;
  }

  function PointerCursors() {
    const scope = deps.useScope();
    const intl = deps.useIntl();
    const enabled = deps.usePointerCursors();
    return <Row label={<FormattedMessage {...messages.pointerCursors} />}
      description={<FormattedMessage id="settings.general.appearance.usePointerCursors.description" defaultMessage="Change the cursor to a pointer when hovering over interactive elements" description="Description for pointer cursor interaction setting" />}
      control={<Toggle checked={enabled === true} onChange={value => {
        scope.setPointerCursors(value).catch(() => {
          scope.toast.danger(<FormattedMessage id="settings.general.appearance.usePointerCursors.saveError" defaultMessage="Could not save pointer cursor preference" description="Error toast when the Use pointer cursors preference cannot be saved" />,
            { errorAnalytics: { toastId: 'settings.general.appearance.usePointerCursors.saveError' } });
        });
      }} ariaLabel={intl.formatMessage(messages.pointerCursors)} />} />;
  }

  function FontSmoothing() {
    const scope = deps.useScope();
    const intl = deps.useIntl();
    const { platform } = deps.usePlatform();
    const enabled = deps.useFontSmoothing();
    if (platform !== 'macOS') return null;
    return <Row label={<FormattedMessage {...messages.fontSmoothing} />}
      description={<FormattedMessage id="settings.general.appearance.fontSmoothing.description" defaultMessage="Use native macOS font anti-aliasing" description="Description for the macOS font smoothing setting" />}
      control={<Toggle checked={enabled} onChange={value => { scope.setFontSmoothing(value); }}
        ariaLabel={intl.formatMessage({ id: 'settings.general.appearance.fontSmoothing.label', defaultMessage: 'Font smoothing', description: 'Label for the macOS font smoothing setting' })} />} />;
  }

  return { ReducedMotion, DiffMarkers, PointerCursors, FontSmoothing };
}
