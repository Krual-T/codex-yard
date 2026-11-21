import type * as T from "../../types";
import type { CodexMetadata } from "./native-pipe";
export { SkyComputerUseError, SkyComputerUseTransportError } from "./errors";
type SkyDiscoveredApp = {
    appPath?: string | null;
    bundleIdentifier?: string;
    displayName?: string;
    isFrontmost?: boolean;
    isRunning?: boolean;
    lastUsedDate?: string | null;
    useCount?: number | null;
};
type RequestOptions = {
    apiVersion?: string;
    codexMetadata?: CodexMetadata;
    timeoutSeconds?: number;
};
type AppArgs = T.Window.AppIdentifier | {
    app?: T.Window.AppIdentifier;
};
type GetAppStateArgs = T.Window.AppIdentifier | {
    app?: T.Window.AppIdentifier;
    disableDiff?: boolean;
};
type StartAudioRecordingArgs = {
    maxDurationMilliseconds?: number;
};
type ClickArgs = {
    app: T.Window.AppIdentifier;
    clickCount?: number;
    elementIndex?: number;
    key?: string;
    duration?: number;
    mouseButton?: T.MouseButton | number;
    x?: number;
    y?: number;
};
type DragArgs = {
    app: T.Window.AppIdentifier;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
};
type PasteArgs = {
    app: T.Window.AppIdentifier;
    text: string;
    format: NonNullable<T.Window.Paste.Input["format"]>;
};
type PerformSecondaryActionArgs = {
    action: string;
    app: T.Window.AppIdentifier;
    elementIndex: number;
};
type PressKeyArgs = {
    app: T.Window.AppIdentifier;
    key: string;
    duration?: number;
};
type ScrollArgs = {
    app: T.Window.AppIdentifier;
    direction: T.Direction;
    elementIndex?: number;
    pages?: number;
    x?: number;
    y?: number;
};
type SelectTextArgs = {
    app: T.Window.AppIdentifier;
    elementIndex: number;
    text: string;
    prefix?: string;
    suffix?: string;
    selection?: T.Window.SelectText.SelectionType;
};
type SetValueArgs = {
    app: T.Window.AppIdentifier;
    elementIndex: number;
    value: string;
};
type TypeTextArgs = {
    app: T.Window.AppIdentifier;
    text: string;
};
type MacApp = {
    bundleIdentifier?: string;
    pid?: number;
};
type MacAppPolicyTarget = {
    appPath: string;
    bundleIdentifier: string;
    displayName: string;
    risk: "high" | "low";
    warningSubtitle?: string | null;
};
export type MacAppPolicyResult = {
    allowPersistentApproval: boolean;
    decision: "allowed" | "denied" | "forbidden";
    target: MacAppPolicyTarget;
};
export type MacWindowSkyshot = {
    text: string;
    screenshot?: {
        url?: string | null;
        mimeType?: string | null;
    } | null;
};
export type MacWindowAppState = {
    app: T.Window.AppIdentifier | MacApp;
    appSpecificInstructions?: string | null;
    skyshot?: MacWindowSkyshot;
};
export type MacAudio = {
    url?: string | null;
};
export declare class MacComputerUseClient {
    private readonly apiVersion;
    private readonly codexMetadata;
    private readonly timeoutSeconds;
    private readonly transports;
    constructor(options?: RequestOptions);
    listApps(options?: RequestOptions): Promise<SkyDiscoveredApp[]>;
    startAudioRecording(args: StartAudioRecordingArgs, options?: RequestOptions): Promise<void>;
    stopAudioRecording(options?: RequestOptions): Promise<MacAudio>;
    getAppPolicy(appOrArgs: AppArgs, options?: RequestOptions): Promise<MacAppPolicyResult>;
    startApp(appOrArgs: AppArgs, options?: RequestOptions): Promise<MacWindowAppState>;
    getAppState(appOrArgs: GetAppStateArgs, options?: RequestOptions): Promise<MacWindowAppState>;
    click(args: ClickArgs, options?: RequestOptions): Promise<void>;
    drag(args: DragArgs, options?: RequestOptions): Promise<void>;
    paste(args: PasteArgs, options?: RequestOptions): Promise<void>;
    performSecondaryAction(args: PerformSecondaryActionArgs, options?: RequestOptions): Promise<void>;
    pressKey(args: PressKeyArgs, options?: RequestOptions): Promise<void>;
    scroll(args: ScrollArgs, options?: RequestOptions): Promise<void>;
    setValue(args: SetValueArgs, options?: RequestOptions): Promise<void>;
    selectText(args: SelectTextArgs, options?: RequestOptions): Promise<void>;
    typeText(args: TypeTextArgs, options?: RequestOptions): Promise<void>;
    private performAction;
    private request;
    private getTransport;
    private transport;
}
export declare const client: MacComputerUseClient;
