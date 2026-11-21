import type { AppIdentifier } from "./AppIdentifier";
import type { Screenshot } from "./Screenshot";
export type AppState = {
    /** App identifier for the captured window. */
    app: AppIdentifier;
    /** Screenshot captured for the app window. */
    screenshot: Screenshot | null;
    /** Accessibility text, prefixed with app-specific guidance on first access when available. */
    text: string;
};
