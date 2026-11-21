export declare class SkyLinuxTransport {
    #private;
    constructor(command: string, args: Array<string>);
    request(command: string, input: unknown): Promise<unknown>;
}
