import type { Filter } from '../build_filters';
import { FilterStateStore } from '../build_filters';
/**
 *
 * @param filter
 * @returns `true` if the filter should be applied to global scope
 *
 * @public
 */
export declare const isFilterPinned: (filter: Filter) => boolean | undefined;
/**
 * @param filter
 * @returns `true` if the filter is disabled
 *
 * @public
 */
export declare const isFilterDisabled: (filter: Filter) => boolean;
/**
 *
 * @param filter
 * @returns A copy of the filter with a toggled disabled state
 *
 * @public
 */
export declare const toggleFilterDisabled: (filter: Filter) => {
    meta: {
        disabled: boolean;
        alias?: string | null | undefined;
        negate?: boolean | undefined;
        controlledBy?: string | undefined;
        group?: string | undefined;
        index?: string | undefined;
        isMultiIndex?: boolean | undefined;
        type?: string | undefined;
        key?: string | undefined;
        params?: import("../build_filters").FilterMetaParams | undefined;
        value?: string | undefined;
    };
    $state?: {
        store: FilterStateStore;
    } | undefined;
    query?: Record<string, any> | undefined;
};
/**
 *
 * @param filter
 * @returns A copy of the filter with a toggled negated state
 *
 * @public
 */
export declare const toggleFilterNegated: (filter: Filter) => {
    meta: {
        negate: boolean;
        alias?: string | null | undefined;
        disabled?: boolean | undefined;
        controlledBy?: string | undefined;
        group?: string | undefined;
        index?: string | undefined;
        isMultiIndex?: boolean | undefined;
        type?: string | undefined;
        key?: string | undefined;
        params?: import("../build_filters").FilterMetaParams | undefined;
        value?: string | undefined;
    };
    $state?: {
        store: FilterStateStore;
    } | undefined;
    query?: Record<string, any> | undefined;
};
/**
 *
 * @param filter
 * @returns A copy of the filter with a toggled pinned state (toggles store from app to global and vice versa)
 *
 * @public
 */
export declare const toggleFilterPinned: (filter: Filter) => {
    $state: {
        store: FilterStateStore;
    };
    meta: import("../build_filters").FilterMeta;
    query?: Record<string, any> | undefined;
};
/**
 * @param filter
 * @returns An enabled copy of the filter
 *
 * @public
 */
export declare const enableFilter: (filter: Filter) => Filter;
/**
 * @param filter
 * @returns A disabled copy of the filter
 *
 * @public
 */
export declare const disableFilter: (filter: Filter) => Filter;
/**
 * @param filter
 * @returns A pinned (global) copy of the filter
 *
 * @public
 */
export declare const pinFilter: (filter: Filter) => Filter;
/**
 * @param filter
 * @returns An unpinned (app scoped) copy of the filter
 *
 * @public
 */
export declare const unpinFilter: (filter: Filter) => Filter;
/**
 * @param {unknown} filter
 * @returns `true` if the given object is a filter
 *
 * @public
 */
export declare const isFilter: (x: unknown) => x is Filter;
/**
 * @param {unknown} filters
 * @returns `true` if the given object is an array of filters
 *
 * @public
 */
export declare const isFilters: (x: unknown) => x is Filter[];
/**
 * Clean out decorators from the filters
 * @param {object} filter The filter to clean
 * @returns {object}
 *
 * @public
 */
export declare const cleanFilter: (filter: Filter) => Partial<Filter>;
