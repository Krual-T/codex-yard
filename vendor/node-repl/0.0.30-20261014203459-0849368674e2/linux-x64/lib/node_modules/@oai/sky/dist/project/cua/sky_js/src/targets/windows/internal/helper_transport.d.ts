export type HelperTransportOptions = {
    helperArgs?: Array<string>;
    helperCommand: string;
    helperEnv?: Record<string, string | undefined>;
    preserveHelperOnTimeout?: boolean;
    timeoutMs?: number;
};
export type HelperRequestOptions = {
    codexTurnMetadata?: unknown;
    createElicitation?: CreateElicitation;
    skipTurnTransition?: boolean;
    timeoutMs?: number;
};
type ElicitationResponse = {
    action?: string;
    content?: unknown;
    _meta?: Record<string, unknown> | null;
};
type CreateElicitation = (request: unknown) => Promise<ElicitationResponse> | ElicitationResponse;
export declare class WindowsHelperTransport {
    #private;
    constructor({ helperArgs, helperCommand, helperEnv, preserveHelperOnTimeout, timeoutMs, }: HelperTransportOptions);
    close(): Promise<void>;
    onEvent(listener: (event: unknown) => void): () => boolean;
    onExit(listener: () => void): () => boolean;
    request(method: string, params: Record<string, unknown>, options?: HelperRequestOptions): Promise<unknown>;
}
export {};
