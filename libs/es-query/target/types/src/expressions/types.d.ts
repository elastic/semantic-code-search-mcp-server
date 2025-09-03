import type { ESQLControlVariable } from '@kbn/esql-types';
import type { Filter, Query, TimeRange } from '../filters';
export interface ExecutionContextSearch {
    now?: number;
    filters?: Filter[];
    query?: Query | Query[];
    timeRange?: TimeRange;
    disableWarningToasts?: boolean;
    esqlVariables?: ESQLControlVariable[];
}
