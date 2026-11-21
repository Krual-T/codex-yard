import type * as T from "./types";
/** Create a screenshot-only Windows desktop session. Close it when finished. */
export declare function create_client(options: {
    target?: "windows";
    api: "desktop";
}): Promise<T.Desktop.Client>;
