import type * as T from "../../types";
import type { MacWindowAppState } from "./client";
export declare function window_result(app: T.Window.AppIdentifier, result: MacWindowAppState, appsWithDeliveredInstructions: Set<string>): Promise<T.Window.AppState>;
