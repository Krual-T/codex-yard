/** Open X11 window that can be inspected, focused, and targeted by input actions. */
export type Window = {
    /** Stable X11 window identifier for the lifetime of this window. */
    id: number;
    /** Desktop application identifier or X11 window class. */
    app: string;
    /** User-visible window title when the application supplies one. */
    title?: string;
    /** Window origin in desktop coordinates. */
    x: number;
    /** Window origin in desktop coordinates. */
    y: number;
    /** Window width in pixels. */
    width: number;
    /** Window height in pixels. */
    height: number;
    /** Whether this window currently owns keyboard focus. */
    focused: boolean;
    /** X11 window type, such as normal, dialog, popup_menu, or tooltip. */
    window_type?: string;
    /** Whether the window manager marks this window as modal. */
    modal: boolean;
};
