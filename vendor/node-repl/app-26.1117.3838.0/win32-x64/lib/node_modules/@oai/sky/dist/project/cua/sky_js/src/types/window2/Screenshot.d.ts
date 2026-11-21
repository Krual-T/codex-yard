export type Screenshot = {
    /** Stable identifier for this screenshot within the latest window state. */
    id: string;
    /** Relative z-order for this screenshot; larger values are visually above smaller values. */
    zIndex: number;
    /** Screenshot image as a data URL. */
    url: string;
    /** Screen X origin for this bounded screenshot region, when available. */
    originX?: number;
    /** Screen Y origin for this bounded screenshot region, when available. */
    originY?: number;
    /** Screenshot width in logical pixels, when available. */
    width?: number;
    /** Screenshot height in logical pixels, when available. */
    height?: number;
};
