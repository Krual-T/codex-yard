import type { TurnSummary } from '../../../lib/codex-protocol.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import type { NativeInjectionRecord, SendIntent, SendRecoveryStore } from './send-recovery.ts';

/** The parent captures both fields synchronously before its first await. */
export interface SendInjectionAuthority {
  daemonConnectionGeneration: string;
  assertBeforeSend(threadId: string): void;
}
export interface NativeSubmissionInjection {
  store: SendRecoveryStore;
  intent: SendIntent;
  authority: SendInjectionAuthority;
}

function assertAuthority(authority: SendInjectionAuthority, threadId: string) {
  if (!authority.daemonConnectionGeneration) throw new Error('原守护进程连接身份缺失，未发送。');
  const result: unknown = authority.assertBeforeSend(threadId);
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => {});
    throw new Error('原发送权限必须同步核对。');
  }
}

async function dispatch(client: WorkbenchClient, store: SendRecoveryStore, intent: SendIntent,
  native: NativeInjectionRecord, step: 'injection' | 'turn', authority: SendInjectionAuthority) {
  const { reference } = native;
  let invoked = false;
  let response: unknown;
  try {
    assertAuthority(authority, reference.threadId);
    invoked = true;
    response = await client.host('send-injection', step === 'injection'
      ? { action: 'inject', hostId: reference.hostId, reference, items: intent.injection!.responseItems,
        turnParams: native.turnParams, daemonConnectionGeneration: authority.daemonConnectionGeneration }
      : { action: 'start', hostId: reference.hostId, reference, turnAttemptId: native.turnAttemptId,
        daemonConnectionGeneration: authority.daemonConnectionGeneration },
    { assertBeforeSend: () => assertAuthority(authority, reference.threadId) });
  } catch (cause) {
    const error = !invoked ? Object.assign(new Error(cause instanceof Error ? cause.message : String(cause), { cause }),
      { uncertain: false, sendPhase: 'before-send' }) : cause;
    await store.nativeHostFailure(intent.id, native, step, error);
    throw error;
  }
  return store.applyNativeStatus(intent.id, native, response);
}

/** Inject once, then start only its original immutable turn through the same host fence. */
export async function sendNativeInjection(client: WorkbenchClient, context: NativeSubmissionInjection,
  threadId: string, turnParams: Record<string, unknown>): Promise<{ turn: TurnSummary }> {
  const { store, intent, authority } = context;
  if (!intent.injection) throw new Error('缺少原上下文发送记录。');
  assertAuthority(authority, threadId);
  let current = intent;
  if (intent.injection.phase === 'prepared') {
    current = await store.reserveNativeInjection(intent, threadId, turnParams, authority.daemonConnectionGeneration);
    const native = current.injection!.native!;
    current = await dispatch(client, store, current, native, 'injection', authority);
  }
  const native = current.injection?.native, status = native?.status;
  if (!native || !status || status.pendingPersistence || current.injection?.phase !== 'confirmed'
    || status.injection.phase !== 'injected' || !['waiting', 'not-sent', 'rejected'].includes(status.turn.phase)) {
    throw Object.assign(new Error('原上下文状态尚未允许发送消息，请核对原发送。'), { uncertain: current.stage === 'unknown' });
  }
  assertAuthority(authority, threadId);
  current = await store.reserveNativeTurn(intent, authority.daemonConnectionGeneration);
  const reserved = current.injection!.native!;
  current = await dispatch(client, store, current, reserved, 'turn', authority);
  const finalStatus = current.injection?.native?.status;
  if (current.stage !== 'confirmed' || finalStatus?.turn.phase !== 'accepted'
    || finalStatus.turn.terminal?.kind !== 'accepted' || finalStatus.pendingPersistence) {
    throw Object.assign(new Error('原消息结果尚未确认，请核对原发送。'), { uncertain: current.stage === 'unknown' });
  }
  return { turn: finalStatus.turn.terminal.result.turn as TurnSummary };
}
