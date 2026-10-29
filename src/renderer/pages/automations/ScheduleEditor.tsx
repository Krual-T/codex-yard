import { useState } from 'react';
import type { ScheduleCodec, ScheduleFields } from './model.ts';
import { errorMessage } from './model.ts';

const weekdays: { value: ScheduleFields['weekday']; label: string }[] = [
  { value: 'MO', label: 'Monday' }, { value: 'TU', label: 'Tuesday' }, { value: 'WE', label: 'Wednesday' },
  { value: 'TH', label: 'Thursday' }, { value: 'FR', label: 'Friday' }, { value: 'SA', label: 'Saturday' }, { value: 'SU', label: 'Sunday' },
];
const initialFields: ScheduleFields = { mode: 'daily', interval: 1, intervalUnit: 'hours', time: '09:00', weekday: 'MO', monthDay: 1 };

export function ScheduleEditor({ value, codec, onChange, onValidChange }: {
  value: string; codec?: ScheduleCodec; onChange(value: string): void; onValidChange(valid: boolean): void;
}) {
  const [fields, setFields] = useState<ScheduleFields | null>(() => {
    if (!codec) return null;
    try { return codec.parse(value); } catch { return null; }
  });
  const [error, setError] = useState<string | null>(null);
  const update = (next: ScheduleFields) => {
    setFields(next);
    try {
      if (!codec) throw new Error('Schedule validation is unavailable.');
      const rule = codec.format(next);
      codec.validate(rule);
      setError(null); onValidChange(true); onChange(rule);
    } catch (cause) { setError(errorMessage(cause)); onValidChange(false); }
  };
  const updateRule = (rule: string) => {
    onChange(rule);
    try { codec?.validate(rule); setError(null); onValidChange(true); }
    catch (cause) { setError(errorMessage(cause)); onValidChange(false); }
  };
  return <fieldset className="yard-automation-fields">
    <legend>Frequency</legend>
    {codec && <label>Repeat<select aria-label="Repeat" value={fields?.mode ?? 'custom'} onChange={event => {
      if (event.target.value === 'custom') { setFields(null); updateRule(value); return; }
      update({ ...(fields ?? initialFields), mode: event.target.value as ScheduleFields['mode'] });
    }}>
      <option value="interval">Interval</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option>
      <option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="custom">Custom</option>
    </select></label>}
    {fields && codec ? <>
      {fields.mode === 'interval' ? <div className="yard-automation-inline">
        <label>Every<input aria-label="Interval duration" type="number" min="1" value={fields.interval} onChange={event => update({ ...fields, interval: Number(event.target.value) })} /></label>
        <label>Unit<select aria-label="Interval unit" value={fields.intervalUnit} onChange={event => update({ ...fields, intervalUnit: event.target.value as ScheduleFields['intervalUnit'] })}><option value="minutes">Minutes</option><option value="hours">Hours</option></select></label>
      </div> : <>
        {fields.mode === 'weekly' && <label>Day<select aria-label="Day" value={fields.weekday} onChange={event => update({ ...fields, weekday: event.target.value as ScheduleFields['weekday'] })}>{weekdays.map(day => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>}
        {fields.mode === 'monthly' && <label>Day of month<input type="number" min="1" max="31" value={fields.monthDay} onChange={event => update({ ...fields, monthDay: Number(event.target.value) })} /></label>}
        <label>Time<input type="time" value={fields.time} onChange={event => update({ ...fields, time: event.target.value })} /></label>
      </>}
    </> : <label>RRULE<textarea aria-label="RRULE" className="yard-automation-rule" rows={2} spellCheck={false} value={value} onChange={event => updateRule(event.target.value)} /></label>}
    {!codec && <p className="yard-automation-muted">Schedule validation is unavailable.</p>}
    {error && <p role="alert" className="yard-automation-error">{error}</p>}
  </fieldset>;
}
