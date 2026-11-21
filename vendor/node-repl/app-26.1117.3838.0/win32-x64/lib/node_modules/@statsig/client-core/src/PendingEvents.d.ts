import { StatsigEventInternal } from './StatsigEvent';
export declare class PendingEvents {
    private _pendingEvents;
    private _batchSize;
    constructor(batchSize: number);
    addToPendingEventsQueue(event: StatsigEventInternal): void;
    hasEventsForFullBatch(): boolean;
    takeAll(): StatsigEventInternal[];
    isEmpty(): boolean;
}
