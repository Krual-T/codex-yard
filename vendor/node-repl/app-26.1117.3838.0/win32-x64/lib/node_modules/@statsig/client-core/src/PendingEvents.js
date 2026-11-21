"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PendingEvents = void 0;
const Log_1 = require("./Log");
class PendingEvents {
    constructor(batchSize) {
        this._pendingEvents = [];
        this._batchSize = batchSize;
    }
    addToPendingEventsQueue(event) {
        this._pendingEvents.push(event);
        Log_1.Log.debug('Enqueued Event:', event);
    }
    hasEventsForFullBatch() {
        return this._pendingEvents.length >= this._batchSize;
    }
    takeAll() {
        const events = this._pendingEvents;
        this._pendingEvents = [];
        return events;
    }
    isEmpty() {
        return this._pendingEvents.length === 0;
    }
}
exports.PendingEvents = PendingEvents;
