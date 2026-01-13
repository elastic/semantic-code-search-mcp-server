import { z } from 'zod';
import { fromKueryExpression, toElasticsearchQuery } from '../../../libs/es-query';
import {
  client,
  getChunksById,
  getLocationsIndexName,
  isIndexNotFoundError,
  formatIndexNotFoundError,
  elasticsearchConfig,
} from '../../utils/elasticsearch';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { splitKqlNodeByStorage } from '../../utils/kql_scoping';

const MAX_CHUNK_QUERY_SIZE = 10000;

/**
 * The Zod schema for the `mapSymbolsByQuery` tool.
 * @property {string} kql - The KQL query string.
 * @property {string} directory - Directory path to explore.
 */
export const mapSymbolsByQuerySchema = z.object({
  kql: z
    .string()
    .optional()
    .describe('KQL query string for filtering (e.g., "language: typescript and kind: function_declaration")'),
  directory: z
    .string()
    .optional()
    .describe(
      'Directory path to explore (e.g., "src/platform/packages/kbn-esql-utils"). Convenience wrapper for filePath filtering.'
    ),
  index: z.string().optional().describe('The Elasticsearch index to search.'),
  size: z.number().optional().describe('The number of top level files to return').default(1000),
});

export type MapSymbolsByQueryParams = z.infer<typeof mapSymbolsByQuerySchema>;

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
function validateAndBuildQuery(input: z.infer<typeof mapSymbolsByQuerySchema>): string {
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
 * Maps symbols that match a given KQL query or directory path.
 *
 * This function uses the `aggregateBySymbolsAndImports` function to perform the
 * aggregation.
 *
 * @param {MapSymbolsByQueryParams} params - The parameters for the function.
 * @returns {Promise<CallToolResult>} A promise that resolves to a
 * `CallToolResult` object containing the aggregated symbols.
 */
export async function mapSymbolsByQuery(params: MapSymbolsByQueryParams): Promise<CallToolResult> {
  const { index, size } = params;

  // Validate and build KQL query
  const kql = validateAndBuildQuery(params);

  const ast = fromKueryExpression(kql);
  const split = splitKqlNodeByStorage(ast);
  const chunkQuery = split.chunkNode ? toElasticsearchQuery(split.chunkNode) : undefined;
  const locationQuery = split.locationNode ? toElasticsearchQuery(split.locationNode) : undefined;

  try {
    const baseIndex = index || elasticsearchConfig.index;
    const locationsIndex = getLocationsIndexName(baseIndex);

    const chunkIds =
      chunkQuery != null
        ? (
            await client.search({
              index: baseIndex,
              query: chunkQuery,
              // We use a higher limit here than some other tools because we may need to join many chunk IDs
              // with locations for large repositories. Reducing this limit risks missing relevant chunks.
              size: MAX_CHUNK_QUERY_SIZE,
              _source: false,
            })
          ).hits.hits
            .map((h) => h._id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        : undefined;

    const locationMust = [
      ...(locationQuery ? [locationQuery] : []),
      ...(chunkIds && chunkIds.length > 0 ? [{ terms: { chunk_id: chunkIds } }] : []),
    ];

    const response = await client.search({
      index: locationsIndex,
      query: locationMust.length > 0 ? { bool: { must: locationMust } } : { match_all: {} },
      size: 0,
      aggs: {
        files: {
          terms: {
            field: 'filePath',
            size: size ?? 1000,
          },
          aggs: {
            chunks: {
              terms: {
                field: 'chunk_id',
                size: 2000,
              },
              aggs: {
                sample: {
                  top_hits: {
                    size: 1,
                    _source: ['startLine'],
                    sort: [{ startLine: { order: 'asc' } }],
                  },
                },
              },
            },
          },
        },
      },
    });

    const buckets = (
      response.aggregations as unknown as {
        files?: {
          buckets?: Array<{
            key: string;
            chunks?: { buckets?: Array<{ key: string; sample?: { hits?: { hits?: Array<{ _source?: unknown }> } } }> };
          }>;
        };
      }
    )?.files?.buckets;

    const allChunkIds = Array.from(new Set((buckets ?? []).flatMap((b) => b.chunks?.buckets?.map((c) => c.key) ?? [])));
    const chunksById = await getChunksById(allChunkIds, { index: baseIndex });

    const results: Record<
      string,
      {
        symbols: Record<string, Array<{ name: string; line: number }>>;
        imports: Record<string, Array<{ path: string; symbols?: string[] }>>;
        exports: Record<string, Array<{ name: string; target?: string }>>;
      }
    > = {};

    for (const fileBucket of buckets ?? []) {
      const filePath = fileBucket.key;
      const symbols: Record<string, Array<{ name: string; line: number }>> = {};
      const imports: Record<string, Array<{ path: string; symbols?: string[] }>> = {};
      const exports: Record<string, Array<{ name: string; target?: string }>> = {};

      for (const chunkBucket of fileBucket.chunks?.buckets ?? []) {
        const chunkId = chunkBucket.key;
        const chunk = chunksById[chunkId];
        if (!chunk) continue;

        const startLine = (chunkBucket.sample?.hits?.hits?.[0]?._source as { startLine?: unknown } | undefined)
          ?.startLine;
        const line = typeof startLine === 'number' ? startLine : 0;

        for (const s of chunk.symbols ?? []) {
          const kind = s.kind ?? 'symbol';
          if (!symbols[kind]) symbols[kind] = [];
          symbols[kind].push({ name: s.name, line });
        }

        for (const imp of chunk.imports ?? []) {
          const type = imp.type;
          if (!imports[type]) imports[type] = [];
          imports[type].push({ path: imp.path, symbols: imp.symbols });
        }

        for (const exp of chunk.exports ?? []) {
          const type = exp.type;
          if (!exports[type]) exports[type] = [];
          exports[type].push({ name: exp.name, ...(exp.target ? { target: exp.target } : {}) });
        }
      }

      results[filePath] = { symbols, imports, exports };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(results) }],
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
