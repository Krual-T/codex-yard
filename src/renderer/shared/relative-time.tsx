/** @jsxRuntime classic */
/** @jsx React.createElement */
import type { ComponentType, ReactNode } from 'react';

export type RelativeTimeUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
export type RelativeTimeDayBasis = 'calendar' | 'elapsed';

export type RelativeTimeMessage = {
  id: string;
  defaultMessage: string;
  description: string;
};

export type RelativeTimeIntl = {
  formatMessage: (message: RelativeTimeMessage, values: { value: number }) => string;
  formatRelativeTime: (
    value: number,
    unit: RelativeTimeUnit,
    options: { numeric: 'always'; style: 'narrow' },
  ) => string;
};

export type RelativeTimeProps = {
  dateString: string;
  format?: 'compact' | 'relative';
  dayBasis?: RelativeTimeDayBasis;
};

export type RelativeTimeDependencies = {
  useNow: () => Date;
  useIntl: () => RelativeTimeIntl;
  getRelativeUnit: (dateString: string, now: Date, dayBasis: RelativeTimeDayBasis) => {
    unit: RelativeTimeUnit;
    value: number;
  };
  FormattedMessage: ComponentType<RelativeTimeMessage>;
};

const compactMessages: Record<RelativeTimeUnit, RelativeTimeMessage> = {
  minute: { id: 'wham.formattedRelativeDateTime.compactMinutesAgo', defaultMessage: '{value}m', description: 'Compact minutes-ago format' },
  hour: { id: 'wham.formattedRelativeDateTime.compactHoursAgo', defaultMessage: '{value}h', description: 'Compact hours-ago format' },
  day: { id: 'wham.formattedRelativeDateTime.compactDaysAgo', defaultMessage: '{value}d', description: 'Compact days-ago format' },
  week: { id: 'wham.formattedRelativeDateTime.compactWeeksAgo', defaultMessage: '{value}w', description: 'Compact weeks-ago format' },
  month: { id: 'wham.formattedRelativeDateTime.compactMonthsAgo', defaultMessage: '{value}mo', description: 'Compact months-ago format' },
  year: { id: 'wham.formattedRelativeDateTime.compactYearsAgo', defaultMessage: '{value}y', description: 'Compact years-ago format' },
};

// Mirrors YEc and ZEc while retaining the App's clock, calendar and locale services.
export function createRelativeTimeComponent(
  React: typeof import('react'),
  { useNow, useIntl, getRelativeUnit, FormattedMessage }: RelativeTimeDependencies,
) {
  function CompactRelativeTime({ dateString, now, dayBasis }: {
    dateString: string;
    now: Date;
    dayBasis: RelativeTimeDayBasis;
  }): ReactNode {
    const intl = useIntl();
    const { unit, value } = getRelativeUnit(dateString, now, dayBasis);
    const message = compactMessages[unit];
    return message == null ? undefined : intl.formatMessage(message, { value });
  }

  return function RelativeTime({
    dateString,
    format = 'compact',
    dayBasis = 'calendar',
  }: RelativeTimeProps): ReactNode {
    const intl = useIntl();
    const now = useNow();

    if (now.getTime() - new Date(dateString).getTime() < 60_000) {
      return <FormattedMessage
        id="wham.formattedRelativeDateTime.justNow"
        defaultMessage="just now"
        description="Relative timestamp for an event that happened less than a minute ago"
      />;
    }
    if (format === 'relative') {
      const { unit, value } = getRelativeUnit(dateString, now, dayBasis);
      return intl.formatRelativeTime(-value, unit, { numeric: 'always', style: 'narrow' });
    }
    return <CompactRelativeTime dateString={dateString} now={now} dayBasis={dayBasis} />;
  };
}
