export type Input = {
    /** Application identifier or name returned by `list_apps()`. */
    app: string;
};
export type Return = Promise<void>;
/** Launch a discoverable desktop application without invoking a shell. */
export type Function = (input: Input) => Return;
