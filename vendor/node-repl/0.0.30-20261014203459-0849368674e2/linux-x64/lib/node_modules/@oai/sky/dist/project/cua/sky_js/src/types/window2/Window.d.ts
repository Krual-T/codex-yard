import type { AppIdentifier } from "../window/AppIdentifier";
export type Window = {
    /** App identifier for the app that owns this window; process-backed identifiers may include the full process path. */
    app: AppIdentifier;
    /** Opaque identifier for the open window. */
    id: number;
    /** User-visible window title when available; may contain PII. */
    title?: string;
};
