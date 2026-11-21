"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._getUnitIDFromUser = exports._getFullUserHash = exports._normalizeUser = void 0;
const Hashing_1 = require("./Hashing");
const Log_1 = require("./Log");
const SafeJs_1 = require("./SafeJs");
function _normalizeUser(original, options, fallbackEnvironment) {
    const copy = (0, SafeJs_1._cloneObject)('StatsigUser', original);
    if (copy == null) {
        Log_1.Log.error('Failed to clone user');
        return { statsigEnvironment: undefined };
    }
    if (options != null && options.environment != null) {
        copy.statsigEnvironment = options.environment;
    }
    else if (fallbackEnvironment != null) {
        copy.statsigEnvironment = { tier: fallbackEnvironment };
    }
    return copy;
}
exports._normalizeUser = _normalizeUser;
function _getFullUserHash(user) {
    return user ? (0, Hashing_1._DJB2Object)(user) : null;
}
exports._getFullUserHash = _getFullUserHash;
function _getUnitIDFromUser(user, idType) {
    var _a, _b, _c;
    if (typeof idType !== 'string') {
        return user.userID;
    }
    const lowered = idType.toLowerCase();
    if (lowered !== 'userid') {
        return (_b = (_a = user.customIDs) === null || _a === void 0 ? void 0 : _a[idType]) !== null && _b !== void 0 ? _b : (_c = user.customIDs) === null || _c === void 0 ? void 0 : _c[lowered];
    }
    return user.userID;
}
exports._getUnitIDFromUser = _getUnitIDFromUser;
