import type { FullDesktopComputerUseClient } from "./full-desktop/FullDesktopComputerUseClient";
import type { Options as FullDesktopOptions } from "./full-desktop/Options";
import type { Options as WindowOptions } from "./window/Options";
import type { WindowComputerUseClient } from "./window/WindowComputerUseClient";
import type { Options as Window2Options } from "./window2/Options";
import type { Window2ComputerUseClient } from "./window2/Window2ComputerUseClient";
export type SkyClient = FullDesktopComputerUseClient | WindowComputerUseClient | Window2ComputerUseClient;
export type Options = FullDesktopOptions | WindowOptions | Window2Options;
