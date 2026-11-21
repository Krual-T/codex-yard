import type * as T from "../../types";
export type SkyLinuxScreenshot = {
    filepath: string;
};
export declare function create_get_screenshot(options: T.FullDesktop.LinuxRuntimeOptions): T.FullDesktop.GetScreenshot.Function;
export declare function load_screenshots(screenshots: Array<SkyLinuxScreenshot>): Promise<{
    filepath: string;
    bytes: Uint8Array<ArrayBuffer>;
    data_url: string;
}[]>;
