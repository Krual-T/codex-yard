"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatsigSession = exports.SessionID = void 0;
const CacheKey_1 = require("./CacheKey");
const Log_1 = require("./Log");
const StorageProvider_1 = require("./StorageProvider");
const UUID_1 = require("./UUID");
const VisibilityObserving_1 = require("./VisibilityObserving");
const MAX_SESSION_IDLE_TIME = 30 * 60 * 1000; // 30 minutes
const MAX_SESSION_AGE = 4 * 60 * 60 * 1000; // 4 hours
const PERSIST_THROTTLE_MS = 15000;
const SESSION_MAP = {};
(0, VisibilityObserving_1._subscribeToVisiblityChanged)((visibility) => {
    if (visibility === 'background') {
        Object.values(SESSION_MAP).forEach((session) => _persistNow(session));
    }
});
exports.SessionID = {
    get: (sdkKey) => {
        return exports.StatsigSession.get(sdkKey).data.sessionID;
    },
};
exports.StatsigSession = {
    get: (sdkKey, bumpSession = true) => {
        if (SESSION_MAP[sdkKey] == null) {
            SESSION_MAP[sdkKey] = _loadOrCreateSharedSession(sdkKey);
        }
        const session = SESSION_MAP[sdkKey];
        return _maybeBumpSession(session, bumpSession);
    },
    overrideInitialSessionID: (override, sdkKey) => {
        const now = Date.now();
        const session = {
            data: {
                sessionID: override,
                startTime: now,
                lastUpdate: now,
            },
            sdkKey,
            lastPersistedAt: Date.now(),
            storageKey: _getSessionIDStorageKey(sdkKey),
        };
        _persistNow(session);
        SESSION_MAP[sdkKey] = session;
    },
    checkForIdleSession: (sdkKey) => {
        const session = SESSION_MAP[sdkKey];
        if (!session) {
            return;
        }
        const sessionExpired = _checkForExpiredSession(session);
        if (sessionExpired) {
            _persistNow(session);
        }
    },
};
function _maybeBumpSession(session, allowSessionBump) {
    const now = Date.now();
    const sessionExpired = _checkForExpiredSession(session);
    if (sessionExpired) {
        _persistNow(session);
    }
    else if (allowSessionBump) {
        session.data.lastUpdate = now;
        _persistThrottled(session);
    }
    return session;
}
function _checkForExpiredSession(session) {
    var _a;
    const data = session.data;
    const sessionExpired = _isIdle(data) || _hasRunTooLong(data);
    if (sessionExpired) {
        session.data = _newSessionData();
        (_a = __STATSIG__ === null || __STATSIG__ === void 0 ? void 0 : __STATSIG__.instance(session.sdkKey)) === null || _a === void 0 ? void 0 : _a.$emt({ name: 'session_expired' });
    }
    return sessionExpired;
}
function _isIdle({ lastUpdate }) {
    return Date.now() - lastUpdate > MAX_SESSION_IDLE_TIME;
}
function _hasRunTooLong({ startTime }) {
    return Date.now() - startTime > MAX_SESSION_AGE;
}
function _getSessionIDStorageKey(sdkKey) {
    return `statsig.session_id.${(0, CacheKey_1._getStorageKey)(sdkKey)}`;
}
function _persistNow(session) {
    try {
        (0, StorageProvider_1._setObjectInStorage)(session.storageKey, session.data);
        session.lastPersistedAt = Date.now();
    }
    catch (e) {
        Log_1.Log.warn('Failed to save SessionID');
    }
}
function _persistThrottled(session) {
    const now = Date.now();
    if (now - session.lastPersistedAt > PERSIST_THROTTLE_MS) {
        _persistNow(session);
    }
}
function _loadSessionFromStorage(storageKey) {
    const data = (0, StorageProvider_1._getObjectFromStorage)(storageKey);
    return data;
}
function _loadOrCreateSharedSession(sdkKey) {
    const storageKey = _getSessionIDStorageKey(sdkKey);
    const existing = _loadSessionFromStorage(storageKey);
    if (existing &&
        existing.sessionID &&
        existing.startTime &&
        existing.lastUpdate) {
        return { data: existing, sdkKey, lastPersistedAt: 0, storageKey };
    }
    return {
        data: _newSessionData(),
        sdkKey,
        lastPersistedAt: 0,
        storageKey,
    };
}
function _newSessionData() {
    return {
        sessionID: (0, UUID_1.getUUID)(),
        startTime: Date.now(),
        lastUpdate: Date.now(),
    };
}
