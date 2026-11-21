import type * as T from "../../types";
export type ComputerUseToolName = keyof T.Window.Client;
type ApprovalResult = "accepted" | "canceled" | "declined";
export declare function logComputerUseClientCreated(): void;
export declare function logComputerUseApprovalRequested(args: {
    bundleIdentifier: string;
    eventCreatedAt: string;
    toolName: ComputerUseToolName;
}): void;
export declare function logComputerUseApprovalResolved(args: {
    approvalPersistence?: "always" | "session";
    approvalResult: ApprovalResult;
    bundleIdentifier: string;
    toolName: ComputerUseToolName;
}): void;
export declare function logComputerUseToolCalled(args: {
    bundleIdentifier?: string;
    durationMs: number;
    terminalStatus: "cancelled" | "completed" | "failed";
    toolName: ComputerUseToolName;
}): void;
export {};
