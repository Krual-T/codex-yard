import { Buffer } from "node:buffer";
export type CodexMetadata = string | Uint8Array | Record<string, unknown> | null | undefined;
type NativePipeConnection = {
    end(): void;
    off(event: "close", listener: () => void): void;
    off(event: "data", listener: (chunk: Uint8Array) => void): void;
    off(event: "error", listener: (error: Error) => void): void;
    on(event: "close", listener: () => void): void;
    on(event: "data", listener: (chunk: Uint8Array) => void): void;
    on(event: "error", listener: (error: Error) => void): void;
    write(data: Uint8Array): void;
};
export declare class MacNativePipeTransport {
    #private;
    static create(apiVersion: string): Promise<MacNativePipeTransport>;
    private static connect;
    constructor(socket: NativePipeConnection, apiVersion: string);
    get isClosed(): boolean;
    request<T>(args: {
        codexMetadata: CodexMetadata;
        request: unknown;
        requestType: string;
        timeoutSeconds: number;
    }): Promise<T>;
    private ping;
}
export declare function decodeMessageFrames(buffer: Buffer): {
    messages: string[];
    remainingData: Buffer<ArrayBufferLike>;
};
export declare function encodeMessageFrame(message: string): Buffer<ArrayBuffer>;
export {};
