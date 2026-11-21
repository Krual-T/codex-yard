---
name: computer-use
description: Control local Mac apps through Computer Use. Use for tasks that require reading or operating app UI by clicking, typing, selecting text, scrolling, dragging, pressing keys, or setting values.
---

## node_repl + @oai/sky (Computer Use)

- Use `node_repl` (JavaScript) for all Computer Use actions.
- Do not use AppleScript, `osascript`, JXA, or System Events scripting for app interaction.
- `node_repl` state is persistent across calls
- For text output, use `nodeRepl.write(...)`. `nodeRepl.write(...)` takes a string. If you would like to read a whole object, wrap with with `JSON.stringify(...)`.

## API surface

```
type Sky = {
  click: (args: { app: string, element_index?: number, x?: number, y?: number, mouse_button?: MouseButton, click_count?: number }) => Promise<void>;
  drag: (args: { app: string, from_x: number, from_y: number, to_x: number, to_y: number }) => Promise<void>;
  get_app_state: (args: { app: string, disableDiff?: boolean }) => Promise<AppState>;
  list_apps: () => Promise<Array<App>>;
  perform_secondary_action: (args: { app: string, element_index: number, action: string }) => Promise<void>;
  press_key: (args: { app: string, key: string }) => Promise<void>;
  scroll: (args: { app: string, element_index: number, direction: Direction, pages?: number }) => Promise<void>;
  select_text: (args: { app: string, element_index: number, text: string, prefix?: string, suffix?: string, selection_type?: SelectionType }) => Promise<void>;
  set_value: (args: { app: string, element_index: number, value: string }) => Promise<void>;
  type_text: (args: { app: string, text: string }) => Promise<void>;
};

type App = {
  id: string;
  displayName?: string;
  lastUsedDate?: string;
  useCount?: number;
  isRunning?: boolean;
};

type AppState = {
  app: string;
  screenshot: Screenshot | null;
  text: string;
};

type Screenshot = {
  url: string;
};

type Direction = "up" | "down" | "left" | "right";
type SelectionType = "text" | "cursor_before" | "cursor_after";
type MouseButton = "left" | "right" | "middle";
```

## Workflow

### 1. Initialize

Start by importing the package API and then getting the state for the app you want to use, like this:

```js
var sky = (globalThis.sky ??= (await import("@oai/sky")).sky);
var state = await sky.get_app_state({ app: "com.google.Chrome" });
nodeRepl.write(state.text); // This will return the accessibility tree
```

If you already know the app's bundle identifier or app name, reference it directly. If it's unclear which app to use, start by listing the available apps:

```js
var sky = (globalThis.sky ??= (await import("@oai/sky")).sky);
var apps = await sky.list_apps();
nodeRepl.write(JSON.stringify(apps));
```

After performing one or more UI actions, call `get_app_state(...)` before deciding what to do next. This keeps you in the current UI state and forces you to re-derive fresh `element_index` values from the latest accessibility text instead of reusing stale ones.

For token efficiency, when appropriate, the accessibility tree will be returned as a diff from the most previous accessibility tree, listing only the elements that were removed, added, or changed. Prefer this default diff output; pass true for `disableDiff` only when you need a fresh full accessibility tree.

### 2. Actions using app

Perform one or more actions, and then fetch the latest state:

```js
await sky.click({ app: "Google Chrome", element_index: 42 });
await sky.set_value({ app: "Google Chrome", element_index: 42, value: "openai.com" });
await sky.press_key({ app: "Google Chrome", key: "Return" });
await sky.type_text({ app: "Google Chrome", text: "hello" });
await sky.scroll({ app: "Google Chrome", element_index: 42, direction: "down", pages: 1 });
await sky.select_text({ app: "Google Chrome", element_index: 42, text: "hello" });
await sky.perform_secondary_action({
  app: "Google Chrome",
  element_index: 42,
  action: "Show Menu",
});
nodeRepl.write((await sky.get_app_state({ app: "Google Chrome" })).text);
```

or you can use the bundle id instead of the name, for example:

```js
await sky.click({ app: "com.google.Chrome", element_index: 42 });
```

Notes:

- Prefer `element_index`-based actions over coordinate actions whenever an accessibility element is available. If AX actions are not available or not working, fall back to using screenshots and coordinate clicks.
- If the UI is not behaving as expected, try fetching the latest `get_app_state(...)` to make sure you have the latest context.
- Prefer using accessibility text over screenshots for efficiency, but if the interface is not fully working or not providing enough context, make sure to fetch a screenshot to get more context. The accessibility interface may be incomplete in some applications, so a screenshot helps fully understand what's going on.
- `perform_secondary_action` is for invoking an accessibility action that an element exposes besides a normal click, such as expanding a disclosure row, showing a menu, incrementing a control, or cancelling something. It requires an action actually exposed for that element in the accessibility text. Do not guess action names.
- `select_text` selects matching text in an editable element. Use `prefix` and `suffix` to disambiguate repeated matches, and `selection_type` to choose whether to select the text itself or place the cursor before or after it.
- `press_key` presses a key or key combination, including modifier and navigation keys. `press_key.key` supports xdotool-style key syntax. Examples: `"a"`, `"Return"`, `"Tab"`, `"super+c"`, `"Up"`, and `"KP_0"` for numpad `0`.
- No need to open or launch apps; `get_app_state` transparently launches the app in the background if it's not already running.
- The `app` parameter may be either an app's display name or bundle identifier.
- If an action or `get_app_state(...)` call fails when targeting an app by display name, immediately retry the same operation with that app's bundle identifier from `list_apps()` before pursuing other debugging paths.
- It's usually not necessary to pause/delay in between performing an action and getting the updated app state. The runtime will automatically wait an appropriate amount of time before capturing the new state if an action was recently performed. (It waits about 1 second, with additional delays of up to 5 seconds if the app has a loading indicator or other signs of state changes.)

## Reading screenshots

Screenshot URLs are in `screenshot.url`, and in this environment they are always `file://` URLs. To read a screenshot:

```js
var fs = await import("node:fs/promises");
var { fileURLToPath } = await import("node:url");

var state = await sky.get_app_state({ app: "com.google.Chrome" });
if (state.screenshot) {
  await nodeRepl.emitImage({
    bytes: await fs.readFile(fileURLToPath(state.screenshot.url)),
    mimeType: "image/png",
  });
}
```

## Paste

Prefer `sky.paste({ app, text, format })` for formatted or multiline content.
`format` must be `"text"`, `"md"`, or `"html"`. Paste uses the system
pasteboard and restores the previous clipboard contents.

For polished documents and slides, focus the intended document position,
placeholder, or text box, compose rich content as HTML, and paste one logical
section or slide-sized block at a time with `format: "html"`. Do not type HTML
markup as plain text. Refresh app state and visually verify the result after
each paste because HTML import support varies by app.
