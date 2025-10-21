import { z } from 'zod';
import { fromKueryExpression, toElasticsearchQuery } from '../../../libs/es-query';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';

import { client, elasticsearchConfig, isIndexNotFoundError, formatIndexNotFoundError } from '../../utils/elasticsearch';

interface CodeChunkDoc {
  type: string;
  language: string;
  kind: string;
  filePath: string;
  content: string;
}

/**
 * The Zod schema for the `semanticCodeSearch` tool.
 * @property {string} [query] - The semantic query string.
 * @property {string} [kql] - The KQL query string.
 * @property {number} [page=1] - The page number for pagination.
 * @property {number} [size=25] - The number of results per page.
 * @property {boolean} [use_reranker=false] - Whether to use Elastic's text-similarity reranker for higher quality ranking.
 */
export const semanticCodeSearchSchema = z.object({
  query: z.string().optional().describe('The semantic query string.'),
  kql: z.string().optional().describe('The KQL query string.'),
  page: z.number().default(1).describe('The page number for pagination.'),
  size: z.number().default(25).describe('The number of results per page.'),
  index: z.string().optional().describe('The Elasticsearch index to search.'),
  use_reranker: z.boolean().default(false).describe('Whether to use Elastic\'s text-similarity reranker for higher quality ranking. Requires a semantic query.'),
});

export type SemanticCodeSearchParams = z.input<typeof semanticCodeSearchSchema>;

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
  const { query, kql, page = 1, size = 25, index, use_reranker = false } = params;

  if (!query && !kql) {
    throw new Error('Either a query for semantic search or a kql filter is required.');
  }

  if (use_reranker && !query) {
    throw new Error('A semantic query is required when using the reranker.');
  }

  const must: QueryDslQueryContainer[] = [];

  if (query) {
    must.push({
      semantic: {
        field: 'semantic_text',
        query: query,
      },
    });
  }

  if (kql) {
    const ast = fromKueryExpression(kql);
    const dsl = toElasticsearchQuery(ast);
    must.push(dsl);
  }

  const baseBoolQuery: QueryDslQueryContainer = {
    bool: {
      must,
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
    // The standard semantic search query with pagination
    const standardQuery = {
      query: baseBoolQuery,
      from: (page - 1) * size,
    };

    // The reranker query that wraps the standard query
    const rerankerQuery = {
      retriever: {
        text_similarity_reranker: {
          retriever: {
            standard: {
              query: baseBoolQuery,
            },
          },
          field: 'semantic_text',
          inference_id: elasticsearchConfig.rerankerInferenceId,
          inference_text: query as string, // query is guaranteed to be defined when use_reranker is true
          rank_window_size: 100,
          min_score: 0.5,
        },
      },
    };

    // Constructing the search parameters based on whether reranking is used
    const params = {
      index: index || elasticsearchConfig.index,
      size,
      ...(use_reranker ? rerankerQuery : standardQuery),
      _source_excludes: ['code_vector', 'semantic_text'],
    };

    // Executing the search query
    const response = await client.search<CodeChunkDoc>(params);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            hits: response.hits.hits.map(hit => {
              const { type, language, kind, filePath, content } = hit._source as CodeChunkDoc;
              return { score: hit._score, type, language, kind, filePath, content };
            }),
            max_score: response.hits.max_score,
          }),
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