import { z } from 'zod';
import { fromKueryExpression, toElasticsearchQuery } from '../../../libs/es-query';
import { aggregateBySymbolsAndImports } from '../../utils/elasticsearch';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';

/**
 * The Zod schema for the `listSymbolsByQuery` tool.
 * @property {string} kql - The KQL query string.
 * @property {string} directory - Directory path to explore.
 */
export const listSymbolsByQuerySchema = z.object({
  kql: z.string().optional().describe('KQL query string for filtering (e.g., "language: typescript and kind: function_declaration")'),
  directory: z.string().optional().describe('Directory path to explore (e.g., "src/platform/packages/kbn-esql-utils"). Convenience wrapper for filePath filtering.'),
  index: z.string().optional().describe('The Elasticsearch index to search.'),
  size: z.number().optional().describe('The number of top level files to return').default(1000),
});

export type ListSymbolsByQueryParams = z.infer<typeof listSymbolsByQuerySchema>;

/**
 * Converts a directory path to a KQL query string.
 * @param directory - The directory path to convert
 * @returns KQL query string for the directory
 */
function buildKqlFromDirectory(directory: string): string {
  // Remove trailing slash if present
  const cleanDir = directory.replace(/\/$/, '');
  
  // Use wildcard for directory and all subdirectories
  return `filePath: ${cleanDir}/*`;
}

/**
 * Validates input parameters and builds the final KQL query.
 * @param input - The input parameters
 * @returns The final KQL query string
 * @throws Error if parameters are invalid or conflicting
 */
function validateAndBuildQuery(input: z.infer<typeof listSymbolsByQuerySchema>): string {
  // Check for conflicting parameters
  if (input.directory && input.kql) {
    throw new Error(
      'Cannot use both "directory" and "kql" parameters together.\n' +
      'Use "directory" for simple directory exploration, or "kql" for advanced filtering.'
    );
  }
  
  // Check for missing parameters
  if (!input.directory && !input.kql) {
    throw new Error(
      'Must provide either "directory" or "kql" parameter.\n' +
      'Examples:\n' +
      '  - { "directory": "src/platform/packages/kbn-esql-utils" }\n' +
      '  - { "kql": "language: typescript and kind: function_declaration" }'
    );
  }
  
  // Build query based on input
  if (input.directory) {
    return buildKqlFromDirectory(input.directory);
  }
  
  return input.kql!;
}

/**
 * Lists symbols that match a given KQL query or directory path.
 *
 * This function uses the `aggregateBySymbolsAndImports` function to perform the
 * aggregation.
 *
 * @param {ListSymbolsByQueryParams} params - The parameters for the function.
 * @returns {Promise<CallToolResult>} A promise that resolves to a
 * `CallToolResult` object containing the aggregated symbols.
 */
export async function listSymbolsByQuery(params: ListSymbolsByQueryParams): Promise<CallToolResult> {
  const { index, size } = params;
  
  // Validate and build KQL query
  const kql = validateAndBuildQuery(params);

  const ast = fromKueryExpression(kql);
  const dsl = toElasticsearchQuery(ast);

  const results = await aggregateBySymbolsAndImports(dsl, index, size);

  return {
    content: [{ type: 'text', text: JSON.stringify(results) }]
  };
}
