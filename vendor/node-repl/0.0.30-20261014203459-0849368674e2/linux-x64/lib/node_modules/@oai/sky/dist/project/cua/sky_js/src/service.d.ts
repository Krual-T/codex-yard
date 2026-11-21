import type * as T from "./types";
export type SkyServiceConfiguration = {
    target: T.SkyClient["target"];
    methods: Array<string>;
};
export type WireMedia = {
    filepath: string;
    data_url: string;
};
export type SkyServiceRequest = {
    type: "setup";
} | {
    type: "execute";
    method: string;
    args: Array<unknown>;
} | {
    type: "drag_start";
    handle_id: string;
    point: T.Point;
} | {
    type: "drag_move";
    handle_id: string;
    point: T.Point;
} | {
    type: "drag_end";
    handle_id: string;
};
export declare function handleRpc(request: SkyServiceRequest): Promise<unknown>;
