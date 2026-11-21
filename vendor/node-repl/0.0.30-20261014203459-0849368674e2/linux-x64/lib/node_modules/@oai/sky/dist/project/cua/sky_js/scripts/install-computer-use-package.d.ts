#!/usr/bin/env bun
export declare const COMPUTER_USE_SERVICE_APP_NAME = "Codex Computer Use.app";
export declare const PLUGIN_ROOT_ENV_VAR = "CODEX_COMPUTER_USE_PLUGIN_ROOT";
export declare const SERVICE_APP_PATH_ENV_VAR = "SKY_CUA_SERVICE_PATH";
export type ComputerUsePluginTarget = {
    path: string;
};
type ResolveOptions = {
    env?: NodeJS.ProcessEnv;
};
export type BuildTarballCommand = {
    args: Array<string>;
    command: string;
    cwd: string;
};
export declare function resolveComputerUsePluginTargets({ env }?: ResolveOptions): {
    path: string;
}[];
export declare function normalizePluginRoot(candidatePath: string): string;
export declare function resolveBuildTarballCommand({ monorepoRoot, platform, projectRoot, tarballPath, }: {
    monorepoRoot: string;
    platform?: NodeJS.Platform;
    projectRoot: string;
    tarballPath: string;
}): {
    command: string;
    args: string[];
    cwd: string;
};
export {};
