"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlushInterval = void 0;
const MIN_FLUSH_INTERVAL_MS = 1000;
const MAX_FLUSH_INTERVAL_MS = 60000;
class FlushInterval {
    constructor() {
        this._currentIntervalMs = MIN_FLUSH_INTERVAL_MS;
        this._lastFlushAttemptTime = Date.now();
    }
    getCurrentIntervalMs() {
        return this._currentIntervalMs;
    }
    markFlushAttempt() {
        this._lastFlushAttemptTime = Date.now();
    }
    getTimeSinceLastAttempt() {
        return Date.now() - this._lastFlushAttemptTime;
    }
    hasReachedMaxInterval() {
        return this.getTimeSinceLastAttempt() >= MAX_FLUSH_INTERVAL_MS;
    }
    getTimeTillMaxInterval() {
        return MAX_FLUSH_INTERVAL_MS - this.getTimeSinceLastAttempt();
    }
    hasCompletelyRecoveredFromBackoff() {
        return this._currentIntervalMs <= MIN_FLUSH_INTERVAL_MS;
    }
    adjustForSuccess() {
        const current = this._currentIntervalMs;
        if (current === MIN_FLUSH_INTERVAL_MS) {
            return;
        }
        this._currentIntervalMs = Math.max(MIN_FLUSH_INTERVAL_MS, Math.floor(current / 2));
    }
    adjustForFailure() {
        const current = this._currentIntervalMs;
        this._currentIntervalMs = Math.min(MAX_FLUSH_INTERVAL_MS, current * 2);
    }
    getTimeUntilNextFlush() {
        return this.getCurrentIntervalMs() - this.getTimeSinceLastAttempt();
    }
}
exports.FlushInterval = FlushInterval;
