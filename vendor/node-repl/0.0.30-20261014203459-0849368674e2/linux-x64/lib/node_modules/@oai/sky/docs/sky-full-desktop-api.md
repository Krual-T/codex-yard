# Sky Full Desktop API

## API Reference

Use this as the supported `sky` full desktop API surface.

On Linux, supplying `window` sends input without activating it or moving the desktop pointer. Omit `window` for desktop-wide input. Use `activate_window` explicitly when you intend to bring a window forward. Targeted input never falls back to activating the window.

```ts
import { sky } from "@oai/sky";

const windows = await sky.list_windows();
// Choose the task's window; it can remain behind another application.
const window = windows.find((window) => window.app === "Chromium");
if (!window) throw new Error("No Chromium window");
const state = await sky.get_window_state({ window });
console.log(state.ax_tree); // Condensed text with element IDs and named actions.
// The object retains its fields; JSON.stringify(state.ax_tree) serializes the full tree.

interface FullDesktopComputerUseClient {
  list_apps(): Promise<Array<ListAppsApp>>; // List launchable applications and any currently open windows they own.
  launch_app(input: LaunchAppInput): Promise<void>; // Launch a discoverable desktop application without invoking a shell.
  list_windows(): Promise<Array<Window>>; // List mapped application windows, including dialogs and transient windows.
  activate_window(input: ActivateWindowInput): Promise<void>; // Raise an open window and direct keyboard focus to it.
  get_window_state(input: GetWindowStateInput): Promise<WindowState>; // Read a window's structured accessibility tree and optional screenshot.
  perform_secondary_action(input: PerformSecondaryActionInput): Promise<void>; // Invoke a named accessibility action.
  get_screenshot(): Promise<Array<Screenshot>>; // Capture screenshots for the full desktop target.
  click(input: ClickInput): Promise<void>; // Click an AX element, coordinates, or the current desktop pointer with no motion.
  drag(input: DragInput): Promise<void>; // Drag through an ordered path of desktop or target-window coordinates.
  drag_handle(): DragHandle; // Create a drag handle for observing screenshots before releasing the mouse button.
  move(input: MoveInput): Promise<void>; // Move the pointer to a desktop or target-window coordinate.
  move_relative(input: MoveRelativeInput): Promise<void>; // Move the desktop pointer by a relative offset using normal desktop input routing.
  press_key(input: PressKeyInput): Promise<void>; // Press a `+`-separated keyboard chord on the desktop or in a target window.
  scroll(input: ScrollInput): Promise<void>; // Scroll over an AX element, window-relative coordinates, or the current desktop target.
  type_text(input: TypeTextInput): Promise<void>; // Type text into an editable AX element or the current focus.
  clipboard_read(input: ClipboardReadInput): Promise<ClipboardHandle>; // Invoke the app's Copy action and return a handle for a saved snapshot of its contents.
  clipboard_release(input: ClipboardReleaseInput): Promise<void>; // Free a saved clipboard snapshot when finished; releasing the same handle again has no effect.
  clipboard_write(input: ClipboardWriteInput): Promise<void>; // Invoke the app's Paste action with the handle's saved contents; the handle can be reused.
  key_down(input: KeyDownInput): Promise<void>; // Hold a keyboard chord across actions.
  key_up(input: KeyUpInput): Promise<void>; // Release a keyboard chord held for the same target.
  target: "linux";
}

type ListAppsApp = {
  id: string; // Desktop-entry identifier accepted by `launch_app()`.
  name: string; // Human-readable application name.
  windows: Array<Window>; // Currently open windows associated with this application.
};

type LaunchAppInput = {
  app: string; // Application identifier or name returned by `list_apps()`.
};

type Window = {
  app: string; // Desktop application identifier or X11 window class.
  focused: boolean; // Whether this window currently owns keyboard focus.
  height: number; // Window height in pixels.
  id: number; // Stable X11 window identifier for the lifetime of this window.
  modal: boolean; // Whether the window manager marks this window as modal.
  title?: string; // User-visible window title when the application supplies one.
  width: number; // Window width in pixels.
  window_type?: string; // X11 window type, such as normal, dialog, popup_menu, or tooltip.
  x: number; // Window origin in desktop coordinates.
  y: number; // Window origin in desktop coordinates.
};

type ActivateWindowInput = {
  window: Window; // Open window returned by `list_windows()` or `list_apps()`.
};

type GetWindowStateInput = {
  include_screenshot?: boolean; // Whether to include a screenshot bounded to the window; defaults to true.
  query?: string; // Case-insensitive accessibility-tree query that retains matching ancestors.
  window: Window; // Open window returned by `list_windows()` or `list_apps()`.
};

type WindowState = {
  ax_tree: AccessibilityNode; // Structured accessibility tree with stable element identifiers.
  ax_tree_source: "at_spi" | "x11"; // Whether the tree came from AT-SPI or the dependency-free X11 fallback.
  screenshots: Array<Screenshot>; // Window-only screenshots when screenshot capture was requested.
  window: Window; // Current metadata for the observed window.
};

type PerformSecondaryActionInput = {
  action: string; // Action name shown under Secondary Actions or in the element's `actions` array.
  element_id: string; // Element ID from the latest `get_window_state()` tree.
  window: Window; // Window whose AT-SPI tree contains the element.
};

type Screenshot = {
  bytes: Uint8Array; // Raw bytes
  data_url: string; // Base64-encoded JPEG data URL
  filepath: string; // Local file path
};

type ClickInput = {
  click_count?: number; // Number of clicks to perform.
  duration?: number; // Milliseconds to hold the mouse button down for each click.
  element_id?: string; // Element ID from `get_window_state().ax_tree`.
  key?: string; // Optional key chord to hold during the click, using the same format as `press_key()`.
  mouse_button?: MouseButton; // Mouse button to click, including "right" to open an element's context menu.
  window?: Window; // Linux target window, which requires coordinates or an element and is not implicitly activated.
  x?: number; // X coordinate on the desktop or within the target window; supply both x and y, or omit both to click at the current desktop pointer.
  y?: number; // Y coordinate on the desktop or within the target window; supply both x and y, or omit both to click at the current desktop pointer.
};

type DragInput = {
  key?: string; // Optional key chord to hold during the drag, using the same format as `press_key()`.
  path: Array<Point>; // At least two desktop or target-window coordinates to visit in order.
  window?: Window; // Linux target window, without implicit activation.
};

type DragHandle = {
  end(): Promise<void>; // Release the mouse button and finish the drag.
  move_to(point: Point): Promise<void>; // Move the pressed mouse button to another desktop coordinate.
  start(point: Point): Promise<void>; // Press the mouse button at the starting desktop coordinate.
};

type MoveInput = {
  key?: string; // Optional key chord to hold while moving, using the same format as `press_key()`.
  window?: Window; // Linux target window, without implicit activation.
  x: number; // X coordinate on the desktop or within the target window.
  y: number; // Y coordinate on the desktop or within the target window.
};

type MoveRelativeInput = {
  dx: number; // Horizontal integer offset in pixels, from -32768 to 32767.
  dy: number; // Vertical integer offset in pixels, from -32768 to 32767.
  key?: string; // Optional key chord to hold while moving, using the same format as `press_key()`.
};

type PressKeyInput = {
  duration?: number; // Milliseconds to hold the key or chord before releasing it.
  key: string; // Key or `+`-separated key chord using X Window System keysym-style names, such as `a`, `space`, `Return`, `Tab`, `Control_L+a`, or `Super_L+d`; whitespace around `+` is ignored and common aliases such as `Ctrl`, `Alt`, and `Shift` are accepted.
  window?: Window; // Target window.
};

type ScrollInput = {
  direction: Direction; // Direction to scroll.
  element_id?: string; // Element ID from `get_window_state().ax_tree` to scroll over.
  key?: string; // Optional key chord to hold during the scroll, using the same format as `press_key()`.
  pixels?: number; // Distance to scroll in pixels.
  window?: Window; // Linux target window, without implicit activation.
  x?: number; // Optional X coordinate for the scroll origin.
  y?: number; // Optional Y coordinate for the scroll origin.
};

type TypeTextInput = {
  element_id?: string; // Editable element ID from `get_window_state().ax_tree`.
  text: string; // Text to type into the selected element or current focus.
  window?: Window; // Target window.
};

type ClipboardReadInput = {
  window: Window; // Window whose current selection should be copied.
};

type ClipboardHandle = string;

type ClipboardReleaseInput = {
  handle: ClipboardHandle; // Snapshot ID returned by clipboard_read() in the current Linux helper.
};

type ClipboardWriteInput = {
  handle: ClipboardHandle; // Reusable snapshot ID from clipboard_read(), valid until released or the Linux helper exits.
  window: Window; // Window whose current focus should receive the clipboard contents.
};

type KeyDownInput = {
  key: string; // Key or `+`-separated chord to hold, using the same format as `press_key()`.
  window?: Window; // Target window.
};

type KeyUpInput = {
  key: string; // Key or `+`-separated chord supplied to `key_down()`.
  window?: Window; // Target window supplied to `key_down()`.
};

type AccessibilityNode = {
  actions?: Array<string>; // Supported action names accepted by `perform_secondary_action`.
  children: Array<AccessibilityNode>; // Nested accessible elements.
  description?: string; // Additional accessible description when one is available.
  id: string; // Compact decimal ID accepted by element actions with this window and client.
  name?: string; // User-visible accessible name when one is available.
  native_id?: string; // Original native identity, retained for inspecting the captured data.
  role: string; // Accessible role, such as window, button, text, or menu item.
  states?: Array<AccessibilityState>; // Current interaction states.
  value?: string; // Current accessible value when one is available.
  to_string(): string; // Condensed tree text, also displayed by `console.log(node)`.
};

type MouseButton = "left" | "right" | "middle" | "l" | "r" | "m";

type Point = {
  x: number; // X coordinate on the desktop screenshot.
  y: number; // Y coordinate on the desktop screenshot.
};

type Direction = "up" | "down" | "left" | "right" | "u" | "d" | "l" | "r";

type AccessibilityState =
  | "checked"
  | "defunct"
  | "editable"
  | "enabled"
  | "expanded"
  | "focusable"
  | "focused"
  | "selected"
  | "sensitive"
  | "showing"
  | "visible"
  | "indeterminate"
  | "checkable";
```
