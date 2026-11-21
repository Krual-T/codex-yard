type PackageBinArgs = {
    relative_path: Array<string>;
    check_exists?: boolean;
    env_var_override?: string;
};
export declare function package_bin(args: PackageBinArgs): string;
export {};
