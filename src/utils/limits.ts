/**
 * Centralized limits for query bounding and sampling.
 *
 * These values are intentionally conservative to keep Elasticsearch requests bounded.
 */

/**
 * Maximum number of semantic candidates to scan when we must apply additional filtering (e.g. KQL)
 * after semantic search. Semantic search is intended to be "top-K"; scanning too deep is expensive.
 */
export const MAX_SEMANTIC_SEARCH_CANDIDATES = 5000;
