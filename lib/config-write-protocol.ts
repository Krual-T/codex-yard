export type ConfigWriteMethod = 'config/batchWrite' | 'skills/config/write';
export type ConfigWriteState = 'preparing' | 'pending' | 'unknown' | 'succeeded' | 'failed';
export type ConfigWriteErrorCategory = 'configVersionConflict' | 'configValidationError' | 'configLayerReadonly';
export type ConfigWriteTerminal =
  | { kind: 'ok' | 'okOverridden' }
  | { kind: 'effectiveEnabled'; value: boolean }
  | { kind: 'rejected'; code?: number; category?: ConfigWriteErrorCategory }
  | { kind: 'not-sent'; code?: 'OBSERVER_LIMIT' };

export interface ConfigWriteReceipt {
  operationId: string;
  hostId: string;
  method: ConfigWriteMethod;
  terminal: ConfigWriteTerminal;
  signature: string;
}

export interface ConfigWriteRecord {
  operationId: string;
  hostId: string;
  hostKey?: string;
  target?: string;
  binding?: string;
  scope?: 'global';
  method?: ConfigWriteMethod;
  state: ConfigWriteState;
  terminal?: ConfigWriteTerminal;
}

export interface ConfigWriteStatus extends ConfigWriteRecord {
  observedTerminal?: ConfigWriteTerminal;
  recoveryReceipt?: ConfigWriteReceipt;
  interrupted?: true;
  storageError?: true;
}

export type ConfigurationWriteRequest =
  | { hostId: string; action: 'submit'; operationId: string; method: ConfigWriteMethod; params: Record<string, unknown> }
  | { hostId: string; action: 'status'; operationId: string }
  | { hostId: string; action: 'retry-persistence'; operationId: string; receipt?: ConfigWriteReceipt };

export interface ConfigurationWriteError {
  message: string;
  uncertain: boolean;
  code?: number | 'OBSERVER_LIMIT';
  category?: ConfigWriteErrorCategory;
}

export type ConfigurationWriteSubmitResponse =
  | { outcome: 'blocked' | 'existing'; operation: ConfigWriteStatus }
  | { outcome: 'success'; result: unknown; operation: ConfigWriteStatus }
  | { outcome: 'error' | 'unknown'; error: ConfigurationWriteError; operation: ConfigWriteStatus }
  | { outcome: 'not-started'; error: ConfigurationWriteError & { uncertain: false }; operation?: ConfigWriteStatus };

export interface ConfigurationWriteStatusResponse { operation: ConfigWriteStatus | null }
export interface ConfigurationWriteRetryResponse { operation: ConfigWriteStatus | null; error?: ConfigurationWriteError }
export type ConfigurationWriteResponse = ConfigurationWriteSubmitResponse | ConfigurationWriteStatusResponse | ConfigurationWriteRetryResponse;
