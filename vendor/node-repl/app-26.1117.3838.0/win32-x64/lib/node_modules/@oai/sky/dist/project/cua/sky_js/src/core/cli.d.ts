import * as child_process from "node:child_process";
import type { Param } from "@oai/types";
type SpawnOptions = Param.Third<typeof child_process.spawn>;
type Options = SpawnOptions & {
    check?: boolean;
    input?: string | Uint8Array;
    quiet?: boolean;
    win32_cmd?: boolean;
};
type Result = {
    command: string;
    code: number;
    stdout: string;
    stderr: string;
    output: string;
};
export declare function cli(unsafe_command: string, unsafe_args: Array<string>, unsafe_options?: Options): Promise<Result>;
export {};
