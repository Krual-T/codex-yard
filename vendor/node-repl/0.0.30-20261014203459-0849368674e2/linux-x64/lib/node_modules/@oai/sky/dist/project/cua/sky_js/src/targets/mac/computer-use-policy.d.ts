import type { ComputerUseToolName } from "./computer-use-telemetry";
type AppInput = {
    app: string;
};
export declare function withComputerUsePolicy<Input extends AppInput, Result>(toolName: ComputerUseToolName, input: Input, operation: (approvedInput: Readonly<Input>) => Promise<Result>): Promise<Result>;
export declare function requestComputerAudioApproval(): Promise<void>;
export declare function withComputerUseToolTelemetry<Result>(toolName: ComputerUseToolName, bundleIdentifier: string | undefined, operation: () => Promise<Result>): Promise<Result>;
export declare function setComputerUseResponseMeta(bundleIdentifier: string | null): void;
export {};
