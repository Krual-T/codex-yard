export declare class FlushInterval {
    private _currentIntervalMs;
    private _lastFlushAttemptTime;
    getCurrentIntervalMs(): number;
    markFlushAttempt(): void;
    getTimeSinceLastAttempt(): number;
    hasReachedMaxInterval(): boolean;
    getTimeTillMaxInterval(): number;
    hasCompletelyRecoveredFromBackoff(): boolean;
    adjustForSuccess(): void;
    adjustForFailure(): void;
    getTimeUntilNextFlush(): number;
}
