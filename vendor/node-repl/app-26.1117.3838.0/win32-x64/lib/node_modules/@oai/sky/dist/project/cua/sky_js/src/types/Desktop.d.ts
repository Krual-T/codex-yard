import type * as Click from "./desktop/Click";
import type * as Close from "./desktop/Close";
import type * as Drag from "./desktop/Drag";
import type * as Move from "./desktop/Move";
import type * as Paste from "./desktop/Paste";
import type * as PressKey from "./desktop/PressKey";
import type * as Scroll from "./desktop/Scroll";
import type * as TypeText from "./desktop/TypeText";
import type * as DragHandle from "./full-desktop/DragHandle";
import type * as GetScreenshot from "./full-desktop/GetScreenshot";
/** A host-enabled Windows desktop session. Coordinates are relative to the latest screenshot. */
export type Client = {
    target: "windows_desktop";
    get_screenshot: GetScreenshot.Function;
    click: Click.Function;
    drag: Drag.Function;
    drag_handle: DragHandle.Function;
    scroll: Scroll.Function;
    move: Move.Function;
    type_text: TypeText.Function;
    press_key: PressKey.Function;
    paste: Paste.Function;
    close: Close.Function;
};
