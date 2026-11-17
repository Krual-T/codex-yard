import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface Recurrence {
  rrule: string;
  timeZone: string;
  anchor: number;
}

/** Keep expensive or impossible RRULEs out of the HTTP server's event loop.
 * UTC is local to the child; rrule's TZID conversion must not inherit host TZ. */
export function nextOccurrence(schedule: Recurrence, after: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const worker = fileURLToPath(new URL('./automation-recurrence-worker.ts', import.meta.url));
    const child = spawn(process.execPath, ['--max-old-space-size=64', worker], {
      env: { TZ: 'UTC' }, stdio: ['pipe', 'pipe', 'ignore'],
    });
    let output = '', settled = false;
    const finish = (error?: Error, next?: number | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(next ?? null);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL'); finish(new Error('定时规则计算超时，请简化规则或检查日期。'));
    }, 3000);
    child.on('error', finish);
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > 8192) { child.kill('SIGKILL'); finish(new Error('定时规则计算结果过大。')); }
    });
    child.on('close', code => {
      if (settled) return;
      try {
        if (code !== 0) throw new Error('定时规则计算失败。');
        const result = JSON.parse(output) as { next?: number | null; error?: string };
        if (result.error) throw new Error(result.error);
        if (result.next !== null && (!Number.isSafeInteger(result.next) || result.next! <= after)) throw new Error('无效的下次执行时间。');
        finish(undefined, result.next);
      } catch (error) { finish(error as Error); }
    });
    child.stdin.end(JSON.stringify({ ...schedule, after }));
  });
}
