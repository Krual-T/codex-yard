"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrecomputedEvaluationsContextHandle = void 0;
const Log_1 = require("./Log");
const SafeJs_1 = require("./SafeJs");
const SessionID_1 = require("./SessionID");
const StableID_1 = require("./StableID");
/**
 * A handle to the PrecomputedEvaluationsContext that computes fields lazily on access.
 * This avoids unnecessary computation (e.g., cloning the user) when only certain fields are needed.
 * The handle is created once and reused; individual getters fetch current values on each access.
 */
class PrecomputedEvaluationsContextHandle {
    constructor(sdkKey, getOptions, getErrorBoundary, getValues, getUser, getSdkInstanceID) {
        this._sdkKey = sdkKey;
        this._getOptions = getOptions;
        this._getErrorBoundary = getErrorBoundary;
        this._getValues = getValues;
        this._getUser = getUser;
        this._getSdkInstanceID = getSdkInstanceID;
    }
    get sdkKey() {
        return this._sdkKey;
    }
    get options() {
        return this._getOptions();
    }
    get errorBoundary() {
        return this._getErrorBoundary();
    }
    get values() {
        return this._getValues();
    }
    get user() {
        let user = (0, SafeJs_1._cloneObject)('StatsigUser', this._getUser());
        if (user == null) {
            Log_1.Log.error('Failed to clone user');
            user = {};
        }
        return user;
    }
    /**
     * Gets the current session.
     * @param {boolean} [bumpSession=true] - Whether to bump/update the session timing. Set to false to read without affecting session state.
     */
    getSession(bumpSession = true) {
        return SessionID_1.StatsigSession.get(this._sdkKey, bumpSession);
    }
    get stableID() {
        return StableID_1.StableID.get(this._sdkKey);
    }
    get sdkInstanceID() {
        return this._getSdkInstanceID();
    }
    /**
     * Returns the full PrecomputedEvaluationsContext object.
     * Use this when you need all fields at once.
     * @param {boolean} [bumpSession=true] - Whether to bump the session when building the context.
     */
    toContext(bumpSession = true) {
        return {
            sdkKey: this.sdkKey,
            options: this.options,
            values: this.values,
            user: this.user,
            errorBoundary: this.errorBoundary,
            session: this.getSession(bumpSession),
            stableID: this.stableID,
            sdkInstanceID: this.sdkInstanceID,
        };
    }
}
exports.PrecomputedEvaluationsContextHandle = PrecomputedEvaluationsContextHandle;
