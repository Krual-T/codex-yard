import type * as T from "../../../types";
export type WindowsComputerUseTransport = {
    close: () => Promise<void>;
    request: (method: string, params: Record<string, unknown>, options?: {
        codexTurnMetadata?: unknown;
    }) => Promise<unknown>;
};
type WindowsComputerUseClientBaseOptions = {
    transport: WindowsComputerUseTransport;
};
export declare class WindowsComputerUseClientBase implements T.Window2.Client {
    #private;
    readonly target = "windows";
    constructor(args: WindowsComputerUseClientBaseOptions);
    close(): Promise<void>;
    activate_window: ({ window }: T.Window2.ActivateWindow.Input) => Promise<void>;
    get_window_state: ({ include_screenshot, include_text, window, }: T.Window2.GetWindowState.Input) => Promise<T.Window2.WindowState>;
    start_audio_recording: (args?: T.Window2.StartAudioRecording.Input) => Promise<void>;
    stop_audio_recording: () => Promise<{
        filepath: string;
        bytes: Uint8Array<ArrayBuffer>;
        data_url: string;
    }>;
    click: (input: T.Window2.Click.Input & {
        element?: unknown;
        elementIndex?: unknown;
    }) => Promise<void>;
    scroll: ({ scrollX, scrollY, screenshotId, window, x, y, }: T.Window2.Scroll.Input) => T.Window2.Scroll.Return;
    drag: ({ window, from_x, from_y, to_x, to_y, screenshotId, }: T.Window2.Drag.Input) => T.Window2.Drag.Return;
    press_key: ({ window, key }: T.Window2.PressKey.Input) => Promise<void>;
    type_text: ({ window, text }: T.Window2.TypeText.Input) => Promise<void>;
    launch_app: (input: T.Window2.LaunchApp.Input) => Promise<void>;
    list_apps: () => Promise<T.Window2.ListApps.App[]>;
    list_windows: () => Promise<T.Window2.Window[]>;
    get_window: (input: T.Window2.GetWindow.Input) => Promise<T.Window2.Window>;
    perform_secondary_action: ({ window, action, element_index, }: T.Window2.PerformSecondaryAction.Input) => Promise<void>;
    set_value: ({ window, element_index, value }: T.Window2.SetValue.Input) => Promise<void>;
    protected closeTransport(): Promise<void>;
}
export {};
