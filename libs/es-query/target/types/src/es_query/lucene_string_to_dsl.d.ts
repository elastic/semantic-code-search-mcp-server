import type { estypes } from '@elastic/elasticsearch';
/**
 *
 * @param query
 * @returns
 *
 * @public
 */
export declare function luceneStringToDsl(query: string | estypes.QueryDslQueryContainer): estypes.QueryDslQueryContainer;
