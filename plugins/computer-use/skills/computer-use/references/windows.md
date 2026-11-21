---
name: computer-use
description: Control Windows apps from Codex.
---

# Computer Use

Use this skill to automate the UI of Microsoft Windows apps.

If this skill is listed as available in the session, treat it as mandatory reading before Windows automation work.
Open and follow this skill before saying that Computer is unavailable and before falling back to other Windows automation methods.
Before using this skill for the first time in the current conversation context, read the entire `SKILL.md` file in one read.

Automates apps via SendInput and UI Automation, and takes screenshots of app windows via Windows.Graphics.Capture that works even if they are occluded.

## node_repl + @oai/sky (Computer Use)

- Use `node_repl` JavaScript for all Computer Use actions.
- The `node_repl` state persists across calls.
- For text output, call `nodeRepl.write(...)` with a string. Use `JSON.stringify(...)` for objects.

## Workflow

### 1. Initialize

Import Sky, list apps, and select a window returned by Sky:

```js
var sky = (globalThis.sky ??= (await import("@oai/sky")).sky);
var apps = await sky.list_apps();
var targetApp = apps.find((app) =>
  /replace-with-app-name-or-id/i.test(String(app.id) + " " + String(app.displayName || "")),
);
var targetWindow = await sky.get_window(targetApp.windows[0]);
await sky.activate_window({ window: targetWindow });
var state = await sky.get_window_state({
  window: targetWindow,
  include_screenshot: true,
  include_text: true,
});
targetWindow = state.window;
nodeRepl.write(String(state.accessibility?.tree || state.accessibility?.document_text || ""));
```

If the target app has no open window, call `sky.launch_app({ app: targetApp.id })`, refresh `list_apps()`, and select a returned window. Use `list_windows()` when inspecting currently open windows or recovering a known running app.

### 2. Act and refresh

Perform related actions against the selected window, then fetch fresh state before deciding what to do next:

```js
var screenshotId = state.screenshots?.[0]?.id;
await sky.click({ window: targetWindow, element_index: 12 });
await sky.click({ window: targetWindow, screenshotId, x: 400, y: 300 });
await sky.set_value({ window: targetWindow, element_index: 12, value: "hello" });
await sky.type_text({ window: targetWindow, text: "hello" });
await sky.press_key({ window: targetWindow, key: "Return" });
await sky.scroll({ window: targetWindow, screenshotId, x: 400, y: 300, scrollX: 0, scrollY: 600 });
await sky.drag({
  window: targetWindow,
  screenshotId,
  from_x: 200,
  from_y: 300,
  to_x: 400,
  to_y: 300,
});
await sky.perform_secondary_action({
  window: targetWindow,
  element_index: 12,
  action: "Expand",
});

state = await sky.get_window_state({
  window: targetWindow,
  include_screenshot: true,
  include_text: true,
});
targetWindow = state.window;
nodeRepl.write(String(state.accessibility?.tree || state.accessibility?.document_text || ""));
```

Use window-relative screenshot coordinates when accessibility elements are unavailable. Pass the matching `screenshotId` for coordinate input.

## Reading screenshots

Screenshots returned by `get_window_state` are displayed automatically. Inspect them directly and use the returned screenshot ID for coordinate actions. Do not decode, save, print, or emit screenshot payloads again solely for inspection.

## Guidelines

- Treat `get_window_state` as an expensive point-in-time snapshot. Batch related inputs, then capture a new state when you need to verify progress or when focus, layout, modality, or element indexes may have changed.
- Element indexes are valid only for the accessibility state that produced them. Refresh accessibility state after any action that may change the visible element tree.
- Screenshots returned by `get_window_state` are displayed automatically. Do not decode, save, or emit them again solely for inspection.
- If state capture or window activation fails, stop using prior coordinates or element indexes. Refresh the app/window selection and retry once; report the exact error if recovery fails.
- If a stored window stops working, recover with `sky.list_windows()`, `sky.get_window({ id: targetWindow.id, app: targetWindow.app })`, `sky.activate_window({ window: targetWindow })`, then `sky.get_window_state({ window: targetWindow, include_screenshot: true, include_text: true })`.
- If you expect a modal in the target app but `get_window_state` does not show it, call `sky.list_windows()` to find the modal or owned secondary window, then capture that returned window with `sky.get_window_state(...)` to obtain its accessibility state.
- If an input call reports that the point is over `StartMenuExperienceHost.exe` or another non-target window, call `sky.activate_window({ window: state.window })`, refresh screenshot-backed state, and retry the intended input once with the refreshed `state.window`.

## API Reference

Use this as the supported `sky` window2 API surface.

```ts
import { sky } from "@oai/sky";

const apps = await sky.list_apps();
const candidate_windows = apps.flatMap((app) => app.windows);
// Choose the task-specific app and window before acting.
// Each input action takes the specific Window for that action.

interface Window2ComputerUseClient {
  list_windows(): Promise<Array<Window>>; // List open windows that can be targeted by the window2 API.
  get_window(input: GetWindowInput): Promise<Window>; // Rehydrate a currently open window by id; useful after losing a window binding.
  list_apps(): Promise<Array<ListAppsApp>>; // List installed apps, including their currently open targetable windows when present.
  launch_app(input: LaunchAppInput): Promise<void>; // Launch an app by id so its window can later be selected from `list_apps()`.
  get_window_state(input: GetWindowStateInput): Promise<WindowState>; // Capture selected state for an open window.
  click(input: ClickInput): Promise<void>; // Click either an indexed element from the latest window state or a coordinate in the window.
  press_key(input: PressKeyInput): Promise<void>; // Press a `+`-separated keyboard chord in a window.
  type_text(input: TypeTextInput): Promise<void>; // Type text into the current focus in a window.
  scroll(input: ScrollInput): Promise<void>; // Scroll by a delta from a specific coordinate in the window screenshot.
  set_value(input: SetValueInput): Promise<void>; // Replace the value of an indexed editable element.
  drag(input: DragInput): Promise<void>; // Drag from one window coordinate to another.
  perform_secondary_action(input: PerformSecondaryActionInput): Promise<void>; // Invoke a secondary accessibility action on an indexed element.
  activate_window(input: ActivateWindowInput): Promise<void>; // Optional escape hatch to bring an open window to the foreground; input methods activate their target window automatically.
}

type Window = {
  app: AppIdentifier; // App identifier for the app that owns this window; process-backed identifiers may include the full process path.
  id: number; // Opaque identifier for the open window.
  title?: string; // User-visible window title when available; may contain PII.
};

type GetWindowInput = {
  app?: AppIdentifier; // Optional app identifier to carry forward from a previously returned `Window`.
  id: number; // Opaque window identifier from a previously returned `Window`.
};

type ListAppsApp = {
  displayName?: string; // User-visible app name when available.
  id: AppIdentifier; // Canonical app id for the app that owns the windows.
  isRunning?: boolean; // Whether the app currently appears to be running.
  lastUsedDate?: string; // ISO 8601 timestamp for recent app usage when available.
  useCount?: number; // Usage count signal when available.
  windows: Array<Window>; // Open windows owned by this app.
};

type LaunchAppInput = {
  app: AppIdentifier; // App id returned by `list_apps()` to launch.
};

type GetWindowStateInput = {
  include_screenshot?: boolean; // Whether to capture and display a screenshot of the window; defaults to true.
  include_text?: boolean; // Whether to capture accessibility text describing visible elements and indexes; defaults to false.
  window: Window; // Window object from `list_apps()` or `list_windows()` to capture.
};

type WindowState = {
  accessibility: AccessibilityState | null; // Structured accessibility state when requested.
  screenshots: Array<Screenshot>; // Bounded screenshots captured for the window and related transient UI.
  window: Window; // Window captured by the state request.
};

type ClickInput = {
  click_count?: number; // Number of clicks to perform.
  element_index?: number; // Element index from the latest `get_window_state()` accessibility tree.
  mouse_button?: MouseButton; // Mouse button to click.
  window: Window; // Window object from `list_apps()` or `list_windows()` to click in.
  x?: number; // X coordinate in the window screenshot.
  y?: number; // Y coordinate in the window screenshot.
  screenshotId?: string; // Screenshot id from the latest `get_window_state()` response for coordinate input.
};

type PressKeyInput = {
  key: string; // Key or `+`-separated key chord using X Window System keysym-style names, such as `a`, `space`, `Return`, `Tab`, `Control_L+a`, `Control_L+Shift_L+period`, or `KP_0`; whitespace around `+` is ignored, and common aliases such as `Control`, `Ctrl`, `Alt`, `Shift`, `period`, `greater`, and `Numpad_0` are accepted.
  window: Window; // Window object from `list_apps()` or `list_windows()` to receive the key press.
};

type TypeTextInput = {
  text: string; // Text to type into the current focus.
  window: Window; // Window object from `list_apps()` or `list_windows()` to type into.
};

type ScrollInput = {
  screenshotId?: string; // Screenshot id from the latest `get_window_state()` response for coordinate input.
  scrollX: number; // Horizontal scroll delta; negative means left, positive means right.
  scrollY: number; // Vertical scroll delta; negative means up, positive means down.
  window: Window; // Window object from `list_apps()` or `list_windows()` to scroll.
  x: number; // X coordinate in the window screenshot to scroll from.
  y: number; // Y coordinate in the window screenshot to scroll from.
};

type SetValueInput = {
  element_index: number; // Element index from the latest `get_window_state()` accessibility tree.
  value: string; // Replacement value for the editable element.
  window: Window; // Window object from `list_apps()` or `list_windows()` containing the editable element.
};

type DragInput = {
  from_x: number; // Starting X coordinate in the window screenshot.
  from_y: number; // Starting Y coordinate in the window screenshot.
  screenshotId?: string; // Screenshot id from the latest `get_window_state()` response for coordinate input.
  to_x: number; // Ending X coordinate in the window screenshot.
  to_y: number; // Ending Y coordinate in the window screenshot.
  window: Window; // Window object from `list_apps()` or `list_windows()` to drag in.
};

type PerformSecondaryActionInput = {
  action: string; // Secondary action label from `get_window_state()`, such as `Raise`, `Scroll Up`, `Scroll Down`, `Scroll Left`, `Scroll Right`, `Expand`, or `Collapse`; matching is case-insensitive.
  element_index: number; // Element index from the latest `get_window_state()` accessibility tree.
  window: Window; // Window object from `list_apps()` or `list_windows()` containing the element.
};

type ActivateWindowInput = {
  window: Window; // Window object from `list_apps()` or `list_windows()` to bring to the foreground.
};

type AppIdentifier = string;

type AccessibilityState = {
  document_text?: string; // Document text for the focused or most relevant document element when available.
  focused_element?: string; // Formatted line for the focused element when available.
  selected_elements?: Array<string>; // Formatted lines for selected elements when available.
  selected_text?: string; // Text selected in the window when available.
  tree: string; // Existing formatted accessibility tree text, including element indexes and tab hierarchy.
};

type Screenshot = {
  url: string; // Screenshot image as a data URL.
};

type MouseButton = "left" | "right" | "middle" | "l" | "r" | "m";
```

## Paste

Use `sky.paste({ window, text, format })` for formatted or multiline content.
`format` must be `"text"`, `"md"`, or
`"html"`; compose rich document and slide content as HTML instead of typing
HTML markup as plain text. Focus the intended editor first, paste one logical
block at a time, then refresh state and visually verify the result.

## App state timing

It's usually not necessary to pause/delay in between performing an action and
getting the updated app state. The runtime will automatically wait an appropriate
amount of time before capturing the new state if an action was recently performed.
(It waits about 1 second, with additional delays of up to 5 seconds if the app has a
loading indicator or other signs of state changes.)
