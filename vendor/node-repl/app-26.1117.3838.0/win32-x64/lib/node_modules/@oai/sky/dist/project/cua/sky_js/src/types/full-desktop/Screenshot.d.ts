export type Screenshot = {
    /** Local file path */
    filepath: string;
    /** Raw bytes */
    bytes: Uint8Array;
    /** Base64-encoded JPEG data URL */
    data_url: string;
};
