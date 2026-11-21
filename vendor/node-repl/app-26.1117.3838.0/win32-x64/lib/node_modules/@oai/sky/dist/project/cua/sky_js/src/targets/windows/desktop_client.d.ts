import type * as Desktop from "../../types/Desktop";
import type * as Click from "../../types/desktop/Click";
import type * as Drag from "../../types/desktop/Drag";
import type * as Move from "../../types/desktop/Move";
import type * as Paste from "../../types/desktop/Paste";
import type * as PressKey from "../../types/desktop/PressKey";
import type * as Scroll from "../../types/desktop/Scroll";
import type * as TypeText from "../../types/desktop/TypeText";
import type * as DragHandle from "../../types/full-desktop/DragHandle";
import type { WindowsComputerUseTransport } from "./internal/computer_use_client_base";
export declare class WindowsDesktopClient implements Desktop.Client {
    #private;
    readonly target = "windows_desktop";
    constructor(transport: WindowsComputerUseTransport);
    get_screenshot: () => Promise<{
        filepath: string;
        bytes: Uint8Array<ArrayBuffer>;
        data_url: string;
    }[]>;
    click: (input: Click.Input) => Promise<void>;
    drag: (input: Drag.Input) => Promise<void>;
    drag_handle: () => DragHandle.Return;
    scroll: (input: Scroll.Input) => Promise<void>;
    move: (input: Move.Input) => Promise<void>;
    type_text: (input: TypeText.Input) => Promise<void>;
    press_key: (input: PressKey.Input) => Promise<void>;
    paste: (input: Paste.Input) => Promise<void>;
    close: () => Promise<void>;
}
