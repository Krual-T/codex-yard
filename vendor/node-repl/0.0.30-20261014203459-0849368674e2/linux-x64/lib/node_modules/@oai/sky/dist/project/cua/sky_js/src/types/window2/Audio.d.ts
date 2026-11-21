export type Audio = {
    /** Local WAV file path. */
    filepath: string;
    /** Raw 24 kHz stereo WAV bytes. */
    bytes: Uint8Array;
    /** Base64-encoded WAV data URL. */
    data_url: string;
};
