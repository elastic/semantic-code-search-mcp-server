import { z } from 'zod';
import { fromKueryExpression, toElasticsearchQuery } from '../../../libs/es-query';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';

import { client, elasticsearchConfig, isIndexNotFoundError, formatIndexNotFoundError } from '../../utils/elasticsearch';

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

  const esQuery: QueryDslQueryContainer = {
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
    const response = await client.search({
      index: index || elasticsearchConfig.index,
      query: esQuery,
      from: (page - 1) * size,
      size: size,
      _source_excludes: ['code_vector', 'semantic_text'],
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            response.hits.hits.map((hit) => {
              const { type, language, kind, filePath, content } = hit._source as {
                type: string;
                language: string;
                kind: string;
                filePath: string;
                content: string;
              };
              return { score: hit._score, type, language, kind, filePath, content };
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
