import { Client, ClientOptions } from '@elastic/elasticsearch';
import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { elasticsearchConfig } from '../config';
export { elasticsearchConfig };

/**
 * The Elasticsearch client instance.
 *
 * This client is configured to connect to the Elasticsearch cluster specified
 * in the environment variables. It is used for all communication with
 * Elasticsearch.
 */
export let client: Client;

const baseOptions: Partial<ClientOptions> = {
  requestTimeout: 90000, // 90 seconds
};

if (elasticsearchConfig.cloudId) {
  client = new Client({
    ...baseOptions,
    cloud: {
      id: elasticsearchConfig.cloudId,
    },
    auth: {
      apiKey: elasticsearchConfig.apiKey || '',
    },
  });
} else if (elasticsearchConfig.endpoint) {
  const clientOptions: ClientOptions = {
    ...baseOptions,
    node: elasticsearchConfig.endpoint,
  };

  if (elasticsearchConfig.apiKey) {
    clientOptions.auth = { apiKey: elasticsearchConfig.apiKey };
  } else if (elasticsearchConfig.username && elasticsearchConfig.password) {
    clientOptions.auth = {
      username: elasticsearchConfig.username,
      password: elasticsearchConfig.password,
    };
  }
  client = new Client(clientOptions);
} else {
  throw new Error(
    'Elasticsearch connection not configured. Please set ELASTICSEARCH_CLOUD_ID or ELASTICSEARCH_ENDPOINT.'
  );
}

const indexName = elasticsearchConfig.index;

export interface SymbolInfo {
  name: string;
  kind?: string;
  line: number;
}

export interface CodeChunk {
  type: 'code' | 'doc';
  language: string;
  kind?: string;
  imports?: { path: string; type: 'module' | 'file'; symbols?: string[] }[];
  symbols?: SymbolInfo[];
  exports?: Array<{ name: string; type: 'named' | 'default' | 'namespace'; target?: string }>;
  containerPath?: string;
  chunk_hash: string;
  content: string;
  semantic_text: string;
  code_vector?: number[];
  created_at: string;
  updated_at: string;
}

export interface SearchResult extends CodeChunk {
  id: string;
  score: number;
}

export interface ChunkLocation {
  chunk_id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  directoryPath?: string;
  directoryName?: string;
  directoryDepth?: number;
  git_file_hash?: string;
  git_branch?: string;
  updated_at: string;
}

const LOCATIONS_INDEX_SUFFIX = '_locations';

export function getLocationsIndexName(index?: string): string {
  return `${index || elasticsearchConfig.index}${LOCATIONS_INDEX_SUFFIX}`;
}

export type ChunkLocationSummary = {
  filePath: string;
  startLine: number;
  endLine: number;
};

export async function getLocationsForChunkIds(
  chunkIds: string[],
  options?: { index?: string; perChunkLimit?: number; query?: QueryDslQueryContainer }
): Promise<Record<string, ChunkLocationSummary[]>> {
  const baseIndex = options?.index || elasticsearchConfig.index;
  const locationsIndex = getLocationsIndexName(baseIndex);
  const perChunkLimit = Math.max(1, Math.min(50, Math.floor(options?.perChunkLimit ?? 5)));

  const uniqueChunkIds = Array.from(new Set(chunkIds)).filter((id) => typeof id === 'string' && id.length > 0);
  if (uniqueChunkIds.length === 0) {
    return {};
  }

  const exists = await client.indices.exists({ index: locationsIndex });
  if (!exists) {
    return {};
  }

  const response = await client.search({
    index: locationsIndex,
    query: {
      bool: {
        must: [
          ...(options?.query ? [options.query] : []),
          {
            terms: {
              chunk_id: uniqueChunkIds,
            },
          },
        ],
      },
    },
    size: 0,
    aggs: {
      by_chunk: {
        terms: {
          field: 'chunk_id',
          size: uniqueChunkIds.length,
        },
        aggs: {
          locations: {
            top_hits: {
              size: perChunkLimit,
              _source: ['filePath', 'startLine', 'endLine'],
              sort: [{ filePath: { order: 'asc' } }, { startLine: { order: 'asc' } }],
            },
          },
        },
      },
    },
  });

  const buckets = (
    response.aggregations as unknown as {
      by_chunk?: { buckets?: Array<{ key?: unknown; locations?: { hits?: { hits?: Array<{ _source?: unknown }> } } }> };
    }
  )?.by_chunk?.buckets;

  const result: Record<string, ChunkLocationSummary[]> = {};
  for (const bucket of buckets ?? []) {
    const chunkId = bucket.key;
    if (typeof chunkId !== 'string') {
      continue;
    }
    const hits = bucket.locations?.hits?.hits ?? [];
    const locations: ChunkLocationSummary[] = [];
    for (const h of hits) {
      const s = h._source as { filePath?: unknown; startLine?: unknown; endLine?: unknown } | undefined;
      if (!s) continue;
      if (typeof s.filePath !== 'string') continue;
      if (typeof s.startLine !== 'number') continue;
      if (typeof s.endLine !== 'number') continue;
      locations.push({ filePath: s.filePath, startLine: s.startLine, endLine: s.endLine });
    }
    result[chunkId] = locations;
  }

  return result;
}

export async function getChunksById(
  chunkIds: string[],
  options?: { index?: string }
): Promise<Record<string, CodeChunk>> {
  const baseIndex = options?.index || elasticsearchConfig.index;
  const uniqueChunkIds = Array.from(new Set(chunkIds)).filter((id) => typeof id === 'string' && id.length > 0);
  if (uniqueChunkIds.length === 0) {
    return {};
  }

  const response = await client.mget<CodeChunk>({
    index: baseIndex,
    ids: uniqueChunkIds,
  });

  const result: Record<string, CodeChunk> = {};
  for (const doc of response.docs) {
    if (!('found' in doc) || !doc.found) continue;
    if (typeof doc._id !== 'string') continue;
    if (!doc._source) continue;
    result[doc._id] = doc._source as CodeChunk;
  }

  return result;
}

/**
 * Performs a semantic search on the code chunks in the index.
 *
 * @param query The natural language query to search for.
 * @returns A promise that resolves to an array of search results.
 */
import { SearchHit } from '@elastic/elasticsearch/lib/api/types';

// ... existing code ...

export async function searchCodeChunks(query: string): Promise<SearchResult[]> {
  const response = await client.search<CodeChunk>({
    index: indexName,
    query: {
      semantic: {
        field: 'semantic_text',
        query: query,
      },
    },
  });
  return response.hits.hits
    .filter((hit): hit is SearchHit<CodeChunk> & { _id: string } => typeof hit._id === 'string' && hit._id.length > 0)
    .map((hit) => ({
      id: hit._id,
      ...(hit._source as CodeChunk),
      score: hit._score ?? 0,
    }));
}

export interface ImportInfo {
  path: string;
  symbols?: string[];
}

export interface ExportInfo {
  name: string;
  target?: string;
}

export interface FileSymbolsAndImports {
  symbols: Record<string, SymbolInfo[]>;
  imports: Record<string, ImportInfo[]>;
  exports: Record<string, ExportInfo[]>;
}

interface FileAggregationWithImports {
  files: {
    buckets: {
      key: string;
      symbols: {
        names: {
          buckets: {
            key: string;
            kind: {
              buckets: {
                key: string;
              }[];
            };
            line: {
              buckets: {
                key: number;
              }[];
            };
          }[];
        };
      };
      imports: {
        paths: {
          buckets: {
            key: string;
            type: {
              buckets: {
                key: 'module' | 'file';
              }[];
            };
            symbols: {
              buckets: {
                key: string;
              }[];
            };
          }[];
        };
      };
      exports: {
        names: {
          buckets: {
            key: string;
            type: {
              buckets: {
                key: string;
              }[];
            };
            target: {
              buckets: {
                key: string;
              }[];
            };
          }[];
        };
      };
    }[];
  };
}

export async function aggregateBySymbolsAndImports(
  query: QueryDslQueryContainer,
  index?: string,
  size?: number
): Promise<Record<string, FileSymbolsAndImports>> {
  const response = await client.search<unknown, FileAggregationWithImports>({
    index: index || elasticsearchConfig.index,
    query,
    aggs: {
      files: {
        terms: {
          field: 'filePath',
          size: size != null ? size : 1000,
        },
        aggs: {
          symbols: {
            nested: {
              path: 'symbols',
            },
            aggs: {
              names: {
                terms: {
                  field: 'symbols.name',
                  size: 1000,
                },
                aggs: {
                  kind: {
                    terms: {
                      field: 'symbols.kind',
                      size: 1,
                    },
                  },
                  line: {
                    terms: {
                      field: 'symbols.line',
                      size: 1,
                    },
                  },
                },
              },
            },
          },
          imports: {
            nested: {
              path: 'imports',
            },
            aggs: {
              paths: {
                terms: {
                  field: 'imports.path',
                  size: 1000,
                },
                aggs: {
                  type: {
                    terms: {
                      field: 'imports.type',
                      size: 1,
                    },
                  },
                  symbols: {
                    terms: {
                      field: 'imports.symbols',
                      size: 100,
                    },
                  },
                },
              },
            },
          },
          exports: {
            nested: {
              path: 'exports',
            },
            aggs: {
              names: {
                terms: {
                  field: 'exports.name',
                  size: 1000,
                },
                aggs: {
                  type: {
                    terms: {
                      field: 'exports.type',
                      size: 1,
                    },
                  },
                  target: {
                    terms: {
                      field: 'exports.target',
                      size: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    size: 0,
  });

  const results: Record<string, FileSymbolsAndImports> = {};
  if (response.aggregations) {
    const files = response.aggregations;
    for (const bucket of files.files.buckets) {
      const filePath = bucket.key;
      const symbols = bucket.symbols.names.buckets
        .map((b) => ({
          name: b.key,
          kind: b.kind.buckets[0].key,
          line: b.line.buckets[0].key,
        }))
        .reduce(
          (acc: Record<string, SymbolInfo[]>, { kind, ...rest }) => {
            if (!acc[kind]) {
              acc[kind] = [];
            }
            acc[kind].push(rest);
            return acc;
          },
          {} as Record<string, SymbolInfo[]>
        );

      const imports = bucket.imports.paths.buckets
        .map((b) => ({
          path: b.key,
          type: b.type.buckets[0].key,
          symbols: b.symbols.buckets.map((s) => s.key),
        }))
        .reduce(
          (acc: Record<string, ImportInfo[]>, { type, ...rest }) => {
            if (!acc[type]) {
              acc[type] = [];
            }
            acc[type].push(rest);
            return acc;
          },
          {} as Record<string, ImportInfo[]>
        );

      const exports = bucket.exports.names.buckets
        .map((b) => ({
          name: b.key,
          type: b.type.buckets[0]?.key,
          target: b.target.buckets[0]?.key,
        }))
        .reduce(
          (acc: Record<string, ExportInfo[]>, { type, name, target }) => {
            if (!type) return acc;
            if (!acc[type]) {
              acc[type] = [];
            }
            acc[type].push({ name, ...(target && { target }) });
            return acc;
          },
          {} as Record<string, ExportInfo[]>
        );

      results[filePath] = { symbols, imports, exports };
    }
  }

  return results;
}

/**
 * Interface for index information used in error messages
 */
export interface IndexInfo {
  name: string;
  fileCount: number;
}

/**
 * Calculates the Levenshtein distance between two strings
 * Used for fuzzy matching index names
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Finds the closest matching index name using Levenshtein distance
 */
function findClosestIndex(requestedIndex: string, availableIndices: IndexInfo[]): string | null {
  if (availableIndices.length === 0) {
    return null;
  }

  let bestMatch: { name: string; distance: number } | null = null;

  for (const indexInfo of availableIndices) {
    const distance = levenshteinDistance(requestedIndex, indexInfo.name);
    const similarityRatio = 1 - distance / Math.max(requestedIndex.length, indexInfo.name.length);

    // Consider it a match if similarity is > 60%
    if (similarityRatio > 0.6 && (!bestMatch || distance < bestMatch.distance)) {
      bestMatch = { name: indexInfo.name, distance };
    }
  }

  return bestMatch ? bestMatch.name : null;
}

/**
 * Gets information about available indices
 * Returns a list of index names and their file counts
 */
export async function getAvailableIndices(): Promise<IndexInfo[]> {
  try {
    const aliasesResponse = await client.indices.getAlias({
      name: `*${LOCATIONS_INDEX_SUFFIX}`,
    });

    if (!aliasesResponse || Object.keys(aliasesResponse).length === 0) {
      return [];
    }

    const indices: IndexInfo[] = [];

    const locationAliases = new Set<string>();
    for (const [, indexInfo] of Object.entries(aliasesResponse)) {
      if (!indexInfo.aliases) continue;
      for (const alias of Object.keys(indexInfo.aliases)) {
        if (alias.endsWith(LOCATIONS_INDEX_SUFFIX)) {
          locationAliases.add(alias);
        }
      }
    }

    const baseAliases = Array.from(locationAliases)
      .map((a) => a.slice(0, -LOCATIONS_INDEX_SUFFIX.length))
      .filter((a) => a.length > 0)
      .sort((a, b) => a.localeCompare(b));

    for (const alias of baseAliases) {
      try {
        const locationsIndex = getLocationsIndexName(alias);
        const searchResponse = await client.search({
          index: locationsIndex,
          size: 0,
          aggs: {
            filesIndexed: { cardinality: { field: 'filePath' } },
          },
        });

        const aggregations = searchResponse.aggregations as { filesIndexed?: { value?: number } } | undefined;
        const fileCount = aggregations?.filesIndexed?.value || 0;
        indices.push({ name: alias, fileCount: Math.round(fileCount) });
      } catch {
        // Skip indices we can't query
        continue;
      }
    }

    return indices;
  } catch {
    // If we can't get available indices, return empty array
    return [];
  }
}

/**
 * Formats a helpful error message when an index is not found
 */
export async function formatIndexNotFoundError(requestedIndex: string): Promise<string> {
  const availableIndices = await getAvailableIndices();

  let errorMessage = `The index '${requestedIndex}' was not found.`;

  if (availableIndices.length > 0) {
    errorMessage += '\n\nAvailable indices:\n';
    for (const indexInfo of availableIndices) {
      const isDefault = indexInfo.name === elasticsearchConfig.index;
      errorMessage += `- ${indexInfo.name} (${indexInfo.fileCount.toLocaleString()} files)${isDefault ? ' (Default)' : ''}\n`;
    }

    // Try to find a close match
    const closestMatch = findClosestIndex(requestedIndex, availableIndices);
    if (closestMatch) {
      errorMessage += `\nDid you mean '${closestMatch}'?`;
    }
  } else {
    errorMessage += '\n\nNo indices found. Please ensure indices are properly configured.';
  }

  return errorMessage;
}

/**
 * Checks if an error is an index_not_found_exception from Elasticsearch
 */
export function isIndexNotFoundError(error: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (error as any)?.meta?.body?.error?.type === 'index_not_found_exception';
}
