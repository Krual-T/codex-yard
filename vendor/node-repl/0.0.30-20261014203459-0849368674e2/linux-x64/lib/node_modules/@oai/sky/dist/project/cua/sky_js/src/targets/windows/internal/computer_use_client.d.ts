import { WindowsComputerUseClientBase } from "./computer_use_client_base";
import type { WindowsComputerUseTransport } from "./computer_use_client_base";
type WindowsComputerUseClientOptions = {
    helperArgs?: Array<string>;
    helperCommand?: string;
    helperPath?: string;
    timeoutMs?: number;
    transport?: WindowsComputerUseTransport;
};
export declare class WindowsComputerUseClient extends WindowsComputerUseClientBase {
    #private;
    constructor(args?: WindowsComputerUseClientOptions);
    protected closeTransport(): Promise<void>;
}
export {};
