import type { AppIdentifier } from "./AppIdentifier";
export type Input = {
    /** App id, display name, process name, or other supported app identifier from `list_apps()`. */
    app: AppIdentifier;
    /** Plain text, HTML, or Markdown content to insert into the current focus. */
    text: string;
    /** Content format: plain text, Markdown, or HTML. */
    format: "text" | "md" | "html";
};
export type Return = Promise<void>;
/** Paste content into an app window, then restore the previous clipboard contents. */
export type Function = (input: Input) => Return;
