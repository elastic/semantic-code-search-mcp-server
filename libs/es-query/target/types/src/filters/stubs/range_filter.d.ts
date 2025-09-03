import { FilterStateStore } from '..';
export declare const rangeFilter: {
    meta: {
        index: string;
        negate: boolean;
        disabled: boolean;
        alias: null;
        type: string;
        key: string;
        value: string;
        params: {
            gte: number;
            lt: number;
        };
    };
    $state: {
        store: FilterStateStore;
    };
    query: {
        range: {};
    };
};
