import { FilterStateStore } from '..';
export declare const phraseFilter: {
    meta: {
        negate: boolean;
        index: string;
        type: string;
        key: string;
        value: string;
        disabled: boolean;
        alias: null;
        params: {
            query: string;
        };
    };
    $state: {
        store: FilterStateStore;
    };
    query: {
        match_phrase: {};
    };
};
