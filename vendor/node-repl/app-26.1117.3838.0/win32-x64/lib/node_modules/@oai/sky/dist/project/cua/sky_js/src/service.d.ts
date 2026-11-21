import type * as T from "./types";
type ClientOptions = {
    target?: "windows";
    api: "desktop";
};
export type SkyServiceConfiguration = {
    target: T.SkyClient["target"];
    methods: Array<string>;
};
export type DesktopSessionInfo = {
    target: T.Desktop.Client["target"];
    client_id: string;
};
export type WireMedia = {
    filepath: string;
    data_url: string;
};
export type SkyServiceRequest = {
    type: "setup";
    window_protocol_version?: 1;
} | {
    type: "create";
    options?: ClientOptions;
} | {
    type: "execute";
    method: string;
    args: Array<unknown>;
    client_id?: string;
    window_protocol_version?: 1;
} | {
    type: "drag_start";
    handle_id: string;
    point: T.Point;
    client_id?: string;
} | {
    type: "drag_move";
    handle_id: string;
    point: T.Point;
    client_id?: string;
} | {
    type: "drag_end";
    handle_id: string;
    client_id?: string;
};
export declare function handleRpc(request: SkyServiceRequest): Promise<unknown>;
export {};
