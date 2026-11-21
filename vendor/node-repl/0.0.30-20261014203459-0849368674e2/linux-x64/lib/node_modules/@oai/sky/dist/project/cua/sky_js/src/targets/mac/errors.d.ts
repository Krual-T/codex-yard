export declare const ServerErrorCode: {
    readonly senderProcessNotAuthenticated: -10000;
    readonly couldNotGetRequestData: -10001;
    readonly couldNotGetRequestTypeName: -10002;
    readonly couldNotResolveRequestType: -10003;
    readonly unhandledEvent: -10004;
    readonly unknownError: -10005;
    readonly appNotAllowed: -10006;
    readonly runningApplicationNotFound: -10007;
    readonly accessibilityError: -10008;
    readonly permissionsNotGranted: -10009;
    readonly invalidApp: -10010;
    readonly noActiveSession: -10011;
    readonly userStoppedSession: -10012;
    readonly incompatibleClientVersion: -10013;
    readonly permissionsPending: -10014;
    readonly blockedURL: -10015;
    readonly userIntervened: -10016;
    readonly couldNotGetSenderPID: -10017;
    readonly ambiguousApp: -10018;
    readonly couldNotGetBootstrapPort: -10019;
    readonly screenLocked: -10020;
};
export declare class SkyComputerUseError extends Error {
    code: number;
    errorName: string;
    request: unknown;
    requestType: string;
    constructor({ code, message, request, requestType, }: {
        code: number;
        message: string;
        request: unknown;
        requestType: string;
    });
}
export declare class SkyComputerUseTransportError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
export declare function formatOSStatus(status: number): string;
