type SessionData = {
    sessionID: string;
    startTime: number;
    lastUpdate: number;
};
export type StatsigSession = {
    data: SessionData;
    sdkKey: string;
    lastPersistedAt: number;
    storageKey: string;
};
export declare const SessionID: {
    get: (sdkKey: string) => string;
};
export declare const StatsigSession: {
    get: (sdkKey: string, bumpSession?: boolean) => StatsigSession;
    overrideInitialSessionID: (override: string, sdkKey: string) => void;
    checkForIdleSession: (sdkKey: string) => void;
};
export {};
