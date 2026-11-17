import { createRequire } from 'node:module';
import type { Recurrence } from './automation-recurrence.ts';

const { rrulestr, RRuleSet } = createRequire(import.meta.url)('rrule') as typeof import('rrule');
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 32768) throw new Error('定时规则过长。');
  }
  const { rrule, timeZone, anchor, after } = JSON.parse(input) as Recurrence & { after: number };
  if (typeof rrule !== 'string' || !rrule.trim() || rrule.length > 4096 ||
      !Number.isSafeInteger(anchor) || !Number.isSafeInteger(after) || typeof timeZone !== 'string') throw new Error('无效的定时规则。');
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = formatter.formatToParts(new Date(anchor));
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === name)!.value;
  const stamp = `${part('year')}${part('month')}${part('day')}T${part('hour')}${part('minute')}00`;
  const start = timeZone === 'UTC' ? `DTSTART:${stamp}Z` : `DTSTART;TZID=${timeZone}:${stamp}`;
  const rule = rrule.trim();
  const text = /(?:^|\n)DTSTART[;:]/.test(rule) ? rule : start + '\n' + (rule.startsWith('FREQ=') ? 'RRULE:' + rule : rule);
  const set = rrulestr(text, { forceset: true, cache: false });
  if (!(set instanceof RRuleSet)) throw new Error('需要完整的定时规则。');
  if (!set.rrules().length && !set.rdates().length) throw new Error('需要 RRULE 或 RDATE。');
  for (const { options: o } of [...set.rrules(), ...set.exrules()]) {
    if (!Number.isSafeInteger(o.interval) || o.interval < 1 || o.count !== null && (!Number.isSafeInteger(o.count) || o.count < 1) ||
        o.freq > 5 || o.byhour?.some(n => n < 0 || n > 23) || o.byminute?.some(n => n < 0 || n > 59) ||
        o.bysecond?.some(n => n < 0 || n > 59) || o.bymonth?.some(n => n < 1 || n > 12)) throw new Error('定时规则包含无效值，最短周期为一分钟。');
  }
  const next = set.after(new Date(after), false);
  process.stdout.write(JSON.stringify({ next: next?.getTime() ?? null }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
}
