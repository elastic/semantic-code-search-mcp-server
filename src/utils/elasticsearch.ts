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
  line: number;
}

export interface CodeChunk {
  type: 'code' | 'doc';
  language: string;
  kind?: string;
  imports?: { path: string; type: 'module' | 'file'; symbols?: string[] }[];
  symbols?: SymbolInfo[];
  containerPath?: string;
  filePath: string;
  git_file_hash: string;
  git_branch: string;
  chunk_hash: string;
  startLine: number;
  endLine: number;
  content: string;
  semantic_text: string;
  code_vector?: number[];
  created_at: string;
  updated_at: string;
}

export interface SearchResult extends CodeChunk {
  score: number;
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
  return response.hits.hits.map((hit: SearchHit<CodeChunk>) => ({
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
 * Discovers repo indices from aliases ending with -repo
 * Returns the actual index names (not alias names) to match the UX goal of showing what users indexed
 */
async function discoverRepoIndicesFromAliases(): Promise<string[]> {
  const repoIndices: string[] = [];

  try {
    const aliasesResponse = await client.indices.getAlias({
      name: '*-repo',
    });

    if (aliasesResponse && Object.keys(aliasesResponse).length > 0) {
      const indexEntries = Object.entries(aliasesResponse);

      for (const [indexName, indexInfo] of indexEntries) {
        if (!indexInfo.aliases) continue;

        // Check if this index has any -repo aliases
        const repoAliases = Object.keys(indexInfo.aliases).filter((alias) => alias.endsWith('-repo'));
        if (repoAliases.length > 0) {
          // Return the actual index name, not the alias name
          // This matches the behavior in list_indices.ts and aligns with the UX goal
          repoIndices.push(indexName);
        }
      }
    }
  } catch (error) {
    // If alias query fails, continue to fallback method
    console.warn('Failed to query aliases:', error);
  }

  return repoIndices;
}

/**
 * Discovers repo indices from _settings pattern
 */
async function discoverRepoIndicesFromSettings(): Promise<string[]> {
  const repoIndices: string[] = [];

  try {
    // Get all indices ending with _settings
    const allIndicesResponse = await client.indices.get({
      index: '*_settings',
    });

    if (allIndicesResponse && Object.keys(allIndicesResponse).length > 0) {
      const settingsIndices = Object.keys(allIndicesResponse);

      for (const settingsIndex of settingsIndices) {
        // Extract base name by removing _settings suffix
        const baseIndexName = settingsIndex.replace(/_settings$/, '');

        // Verify the base index exists (it should, as indexer creates both)
        try {
          const indexExists = await client.indices.exists({
            index: baseIndexName,
          });

          if (indexExists) {
            repoIndices.push(baseIndexName);
          }
        } catch {
          // Skip if we can't verify the base index exists
          continue;
        }
      }
    }
  } catch (error) {
    // If settings discovery fails, return empty array
    console.warn('Failed to discover indices from _settings pattern:', error);
  }

  return repoIndices;
}

/**
 * Gets information about available indices
 * Returns a list of index names (not alias names) and their file counts
 * Uses both alias-based discovery (backward compatible) and _settings-based discovery (fallback)
 *
 * Note: Returns actual index names (e.g., 'kibana') not alias names (e.g., 'kibana-repo')
 * to match the UX goal of showing what users actually indexed
 */
export async function getAvailableIndices(): Promise<IndexInfo[]> {
  try {
    // Strategy 1: Discover from aliases (backward compatible)
    const aliasIndices = await discoverRepoIndicesFromAliases();

    // Strategy 2: Discover from _settings indices (fallback)
    const settingsIndices = await discoverRepoIndicesFromSettings();

    // Merge and deduplicate
    const allIndexNames = Array.from(new Set([...aliasIndices, ...settingsIndices]));

    if (allIndexNames.length === 0) {
      return [];
    }

    const indices: IndexInfo[] = [];

    for (const indexName of allIndexNames) {
      try {
        const searchResponse = await client.search({
          index: indexName,
          size: 0,
          aggs: {
            filesIndexed: { cardinality: { field: 'filePath' } },
          },
        });

        const aggregations = searchResponse.aggregations as { filesIndexed?: { value?: number } } | undefined;
        const fileCount = aggregations?.filesIndexed?.value ?? 0;
        indices.push({ name: indexName, fileCount: Math.round(fileCount) });
      } catch {
        // Skip indices we can't query
        continue;
      }
    }

    return indices;
  } catch (error) {
    // If we can't get available indices, return empty array
    console.warn('Failed to get available indices:', error);
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
