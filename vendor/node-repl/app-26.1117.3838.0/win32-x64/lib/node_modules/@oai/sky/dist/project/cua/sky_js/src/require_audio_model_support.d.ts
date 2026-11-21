type AudioModelPolicy = {
    model_allowlist: string | undefined;
    request_meta: Record<string, unknown> | undefined;
};
/** Enforce the host's audio catalog against trusted metadata on each recording request. */
export declare function require_audio_model_support(args: AudioModelPolicy): void;
export {};
