import { z } from 'zod';
import { fromKueryExpression, toElasticsearchQuery } from '../../../libs/es-query';
import { getKqlFieldNamesFromExpression } from '../../../libs/es-query/src/kuery';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';

import { client, elasticsearchConfig, isIndexNotFoundError, formatIndexNotFoundError } from '../../utils/elasticsearch';
import { getLocationsForChunkIds } from '../../utils/elasticsearch';
import { splitKqlNodeByStorage } from '../../utils/kql_scoping';
import { filterChunkIdsByKqlWithinUniverse } from '../../utils/kql_chunk_id_filter';
import { LOCATION_FIELDS } from '../../utils/kql_scoping';
import { MAX_SEMANTIC_SEARCH_CANDIDATES } from '../../utils/limits';

/**
 * The Zod schema for the `semanticCodeSearch` tool.
 * @property {string} [query] - The semantic query string.
 * @property {string} [kql] - The KQL query string.
 * @property {number} [page=1] - The page number for pagination.
 * @property {number} [size=25] - The number of results per page.
 */
export const semanticCodeSearchSchema = z.object({
  query: z.string().optional().describe('The semantic query string.'),
  kql: z.string().optional().describe('The KQL query string.'),
  page: z.number().default(1).describe('The page number for pagination.'),
  size: z.number().default(25).describe('The number of results per page.'),
  index: z.string().optional().describe('The Elasticsearch index to search.'),
});

export type SemanticCodeSearchParams = z.infer<typeof semanticCodeSearchSchema>;

/**
 * Performs a semantic search on the code chunks in the index.
 *
 * This function can combine a semantic query with a KQL filter to provide
 * flexible and powerful search capabilities.
 *
 * @param {SemanticCodeSearchParams} params - The parameters for the search.
 * @returns {Promise<CallToolResult>} A promise that resolves to a
 * `CallToolResult` object containing the search results.
 */
export async function semanticCodeSearch(params: SemanticCodeSearchParams): Promise<CallToolResult> {
  const { query, kql, page, size, index } = params;

  if (!query && !kql) {
    throw new Error('Either a query for semantic search or a kql filter is required.');
  }

  const baseIndex = index || elasticsearchConfig.index;

  // Fast-path: KQL-only searches that reference only chunk fields can run directly on <index>.
  if (!query && kql) {
    // If KQL includes location fields and there's no semantic query to establish a bounded universe,
    // the split-index evaluation can become unbounded (especially with NOT). Require `query`.
    const kqlFields = getKqlFieldNamesFromExpression(kql);

    const hasLocationField = kqlFields.some((f: string) => LOCATION_FIELDS.has(f));
    if (hasLocationField) {
      throw new Error(
        'KQL-only searches that reference file-level fields (e.g. filePath/directoryPath/startLine) require a semantic `query`.\n' +
          'This MCP uses a split index model (<index> + <index>_locations) and needs a bounded candidate set to evaluate such filters safely.'
      );
    }
  }

  const semanticQueryDsl: QueryDslQueryContainer | undefined =
    query != null
      ? {
          semantic: {
            field: 'semantic_text',
            query,
          },
        }
      : undefined;

  // Optional chunk-side KQL clauses that are safe to push down for the initial search.
  let chunkFilterDsl: QueryDslQueryContainer | undefined;
  // Optional location-side KQL clause used ONLY to filter location samples when safe (AND-only split).
  let safeLocationSampleFilter: QueryDslQueryContainer | undefined;

  if (kql) {
    const ast = fromKueryExpression(kql);
    const split = splitKqlNodeByStorage(ast);
    if (split.chunkNode) {
      chunkFilterDsl = toElasticsearchQuery(split.chunkNode);
    }
    if (split.locationNode && !split.hasMixed) {
      safeLocationSampleFilter = toElasticsearchQuery(split.locationNode);
    }
  }

  const baseMust: QueryDslQueryContainer[] = [];
  if (semanticQueryDsl) baseMust.push(semanticQueryDsl);
  if (chunkFilterDsl) baseMust.push(chunkFilterDsl);

  const baseEsQuery: QueryDslQueryContainer = {
    bool: {
      must: baseMust.length > 0 ? baseMust : [{ match_all: {} }],
      should: [
        {
          term: {
            language: {
              value: 'markdown',
              boost: 2,
            },
          },
        },
      ],
    },
  };

  try {
    const targetCount = page * size;
    const collected: Array<{ id: string; score: number; source: unknown }> = [];

    // Fetch semantic candidates in increasing batches until we can satisfy the requested page
    // after applying KQL (which may require evaluating against <index>_locations).
    const batchSize = Math.max(50, Math.min(500, size * 4));
    let from = 0;

    while (collected.length < targetCount) {
      const response = await client.search({
        index: baseIndex,
        query: baseEsQuery,
        from,
        size: batchSize,
        _source_excludes: ['code_vector', 'semantic_text'],
      });

      const hits = response.hits.hits.filter((h): h is typeof h & { _id: string } => typeof h._id === 'string');
      if (hits.length === 0) break;

      if (!kql) {
        for (const hit of hits) {
          collected.push({ id: hit._id, score: hit._score ?? 0, source: hit._source });
        }
      } else {
        const universeIds = hits.map((h) => h._id);
        const allowed = await filterChunkIdsByKqlWithinUniverse({
          kql,
          baseIndex,
          universeChunkIds: universeIds,
        });

        for (const hit of hits) {
          if (allowed.has(hit._id)) {
            collected.push({ id: hit._id, score: hit._score ?? 0, source: hit._source });
          }
        }
      }

      from += hits.length;
      if (hits.length < batchSize) break; // end of results
      if (from > MAX_SEMANTIC_SEARCH_CANDIDATES) break; // keep bounded; semantic search is intended to be top-K
    }

    const pageItems = collected.slice((page - 1) * size, page * size);
    const locationsById = await getLocationsForChunkIds(
      pageItems.map((h) => h.id),
      { index: baseIndex, perChunkLimit: 5, query: safeLocationSampleFilter }
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            pageItems.map((hit) => {
              const { type, language, kind, content } = hit.source as {
                type: string;
                language: string;
                kind: string;
                content: string;
              };

              return {
                id: hit.id,
                score: hit.score,
                type,
                language,
                kind,
                content,
                locations: locationsById[hit.id] ?? [],
              };
            })
          ),
        },
      ],
    };
  } catch (error) {
    if (isIndexNotFoundError(error)) {
      const errorMessage = await formatIndexNotFoundError(index || elasticsearchConfig.index);
      return {
        content: [{ type: 'text', text: errorMessage }],
        isError: true,
      };
    }
    throw error;
  }
}
