/** @jsxRuntime classic */
/** @jsx React.createElement */
import type { ComponentType } from 'react';

export type ThemeSection = 'visual' | 'advanced';
export type ThemeVariant = 'light' | 'dark';

export interface ThemeVariantSettingsProps {
  section: ThemeSection;
  showTranslucentSidebarToggle: boolean;
  showVariantTitle: boolean;
  variant: ThemeVariant;
}

export interface ThemeVariantsProps {
  section: ThemeSection;
  separateModes: boolean;
}

export interface ThemeVariantsDependencies {
  useCurrentVariant: () => ThemeVariant;
  useBackdropSupport: () => { data?: { isSystemBackdropSupported?: boolean } | null };
  ThemeVariantSettings: ComponentType<ThemeVariantSettingsProps>;
}

/** Qa: choose which original saved theme variants the form displays. */
export function createThemeVariantsComponent(React: typeof import('react'), deps: ThemeVariantsDependencies) {
  const { ThemeVariantSettings } = deps;
  return function ThemeVariants({ section, separateModes }: ThemeVariantsProps) {
    const currentVariant = deps.useCurrentVariant();
    const { data } = deps.useBackdropSupport();
    const showTranslucentSidebarToggle = data?.isSystemBackdropSupported !== false;
    const variants: ThemeVariant[] = separateModes ? ['light', 'dark'] : [currentVariant];
    return <div className="flex flex-col gap-[var(--padding-panel)]">
      {variants.map(variant => <ThemeVariantSettings key={variant} section={section}
        showTranslucentSidebarToggle={showTranslucentSidebarToggle}
        showVariantTitle={variants.length > 1} variant={variant} />)}
    </div>;
  };
}
