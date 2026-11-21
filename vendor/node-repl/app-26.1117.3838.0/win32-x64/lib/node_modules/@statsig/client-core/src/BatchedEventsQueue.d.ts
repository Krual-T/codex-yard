import { EventBatch } from './EventBatch';
import { StatsigEventInternal } from './StatsigEvent';
export declare class BatchQueue {
    private _batches;
    private _batchSize;
    constructor(batchSize?: number);
    batchSize(): number;
    requeueBatch(batch: EventBatch): number;
    hasFullBatch(): boolean;
    takeNextBatch(): EventBatch | undefined;
    takeAllBatches(): EventBatch[];
    createBatches(events: StatsigEventInternal[]): number;
    private _enqueueBatch;
}
