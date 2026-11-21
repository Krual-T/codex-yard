export type Audio = {
    /** Local file path */
    filepath: string;
    /** Raw WAV bytes captured at 24 kHz */
    bytes: Uint8Array;
    /** Base64-encoded WAV data URL */
    data_url: string;
};
