import type { ComponentType, ReactNode } from 'react';

export interface MessageDescriptor {
  id: string;
  defaultMessage: string;
  description: string;
}

export interface SettingsGroupProps {
  children?: ReactNode;
  id?: string;
}

export type SettingsGroup = ComponentType<SettingsGroupProps> & {
  Header: ComponentType<{ title: ReactNode; actions?: ReactNode }>;
  Content: ComponentType<{ children?: ReactNode; className?: string }>;
};

export interface SettingsPrimitives {
  Group: SettingsGroup;
  Rows: ComponentType<{ children?: ReactNode }>;
  FormattedMessage: ComponentType<MessageDescriptor>;
}

export interface ControlLabels {
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

export interface SettingRowProps {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode | ((labels: ControlLabels) => ReactNode);
  className?: string;
  variant?: 'nested';
  size?: 'compact';
}

export interface ToggleProps extends ControlLabels {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
}

export interface SettingsPageProps {
  title: ReactNode;
  children?: ReactNode;
}
