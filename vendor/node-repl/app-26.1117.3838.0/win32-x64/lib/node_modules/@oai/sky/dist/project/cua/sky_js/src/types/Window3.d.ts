import type * as Mac from "./window";
import type * as Window2 from "./window2";
import type * as Click from "./window3/Click";
import type * as GetWindow from "./window3/GetWindow";
import type * as GetWindowState from "./window3/GetWindowState";
import type * as ListApps from "./window3/ListApps";
import type * as ListWindows from "./window3/ListWindows";
import type * as Move from "./window3/Move";
import type * as Scroll from "./window3/Scroll";
import type { Window } from "./window3/Window";
export type { AppIdentifier } from "./window/AppIdentifier";
export type { Screenshot } from "./window2/Screenshot";
export type { AccessibilityState, WindowState } from "./window3/GetWindowState";
export type { App } from "./window3/ListApps";
export type { Window, WindowID } from "./window3/Window";
/** Existing app- and window-scoped actions keep their arguments and return type when bound to a Window3 window. */
type WindowAction<Action extends (input: never) => unknown> = (input: Omit<Parameters<Action>[0], "app" | "window"> & {
    window: Window;
}) => ReturnType<Action>;
export interface Client {
    readonly target: "windows";
    list_apps: ListApps.Function;
    list_windows: ListWindows.Function;
    get_window: GetWindow.Function;
    launch_app: Window2.LaunchApp.Function;
    get_window_state: GetWindowState.Function;
    click: Click.Function;
    move: Move.Function;
    drag: WindowAction<Window2.Drag.Function>;
    scroll: Scroll.Function;
    press_key: WindowAction<Window2.PressKey.Function>;
    /** Activate the window and type into its focused control. */
    type_text: WindowAction<Window2.TypeText.Function>;
    paste: WindowAction<Mac.Paste.Function>;
    select_text: WindowAction<Mac.SelectText.Function>;
    set_value: WindowAction<Window2.SetValue.Function>;
    /** Use activate_window when an element advertises Raise. */
    perform_secondary_action: WindowAction<Window2.PerformSecondaryAction.Function>;
    /** Explicitly bring this window to the foreground. */
    activate_window: WindowAction<Window2.ActivateWindow.Function>;
    start_audio_recording?: Window2.StartAudioRecording.Function;
    stop_audio_recording?: Window2.StopAudioRecording.Function;
}
