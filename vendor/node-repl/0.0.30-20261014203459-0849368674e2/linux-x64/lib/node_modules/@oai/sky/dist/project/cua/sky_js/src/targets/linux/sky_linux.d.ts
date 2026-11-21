import type * as T from "../../types";
type Command = keyof T.FullDesktop.Client;
type Args = {
    options: T.FullDesktop.LinuxOptions;
    input?: unknown;
};
export declare function sky_linux(command: Command, args: Args): Promise<string>;
export {};
