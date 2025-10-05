import { z } from 'zod';
import { fromKueryExpression, toElasticsearchQuery } from '../../../libs/es-query';
import { aggregateBySymbolsAndImports } from '../../utils/elasticsearch';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';

/**
 * The Zod schema for the `listSymbolsByQuery` tool.
 * @property {string} kql - The KQL query string.
 */
export const listSymbolsByQuerySchema = z.object({
  kql: z.string().describe('The KQL query string.'),
  index: z.string().optional().describe('The Elasticsearch index to search.'),
  size: z.number().optional().describe('The number of top level files to return').default(1000),
});

export type ListSymbolsByQueryParams = z.infer<typeof listSymbolsByQuerySchema>;

/**
 * Lists symbols that match a given KQL query.
 *
 * This function uses the `aggregateBySymbolsAndImports` function to perform the
 * aggregation.
 *
 * @param {ListSymbolsByQueryParams} params - The parameters for the function.
 * @returns {Promise<CallToolResult>} A promise that resolves to a
 * `CallToolResult` object containing the aggregated symbols.
 */
export async function listSymbolsByQuery(params: ListSymbolsByQueryParams): Promise<CallToolResult> {
  const { kql, index, size } = params;

  const ast = fromKueryExpression(kql);
  const dsl = toElasticsearchQuery(ast);

  const results = await aggregateBySymbolsAndImports(dsl, index, size);

  return {
    content: [{ type: 'text', text: JSON.stringify(results) }]
  };
}
