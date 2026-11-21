"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchQueue = void 0;
const EventBatch_1 = require("./EventBatch");
const EventRetryConstants_1 = require("./EventRetryConstants");
class BatchQueue {
    constructor(batchSize = EventRetryConstants_1.EventRetryConstants.DEFAULT_BATCH_SIZE) {
        this._batches = [];
        this._batchSize = batchSize;
    }
    batchSize() {
        return this._batchSize;
    }
    requeueBatch(batch) {
        return this._enqueueBatch(batch);
    }
    hasFullBatch() {
        return this._batches.some((batch) => batch.events.length >= this._batchSize);
    }
    takeNextBatch() {
        return this._batches.shift();
    }
    takeAllBatches() {
        const batches = this._batches;
        this._batches = [];
        return batches;
    }
    createBatches(events) {
        let i = 0;
        let droppedCount = 0;
        while (i < events.length) {
            const chunk = events.slice(i, i + this._batchSize);
            droppedCount += this._enqueueBatch(new EventBatch_1.EventBatch(chunk));
            i += this._batchSize;
        }
        return droppedCount;
    }
    _enqueueBatch(batch) {
        this._batches.push(batch);
        let droppedEventCount = 0;
        while (this._batches.length > EventRetryConstants_1.EventRetryConstants.MAX_PENDING_BATCHES) {
            const dropped = this._batches.shift();
            if (dropped) {
                droppedEventCount += dropped.events.length;
            }
        }
        return droppedEventCount;
    }
}
exports.BatchQueue = BatchQueue;
