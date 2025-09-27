import { Client, ClientOptions } from '@elastic/elasticsearch';
import {
  QueryDslQueryContainer,
} from '@elastic/elasticsearch/lib/api/types';
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

export interface FileSymbolsAndImports {
  symbols: Record<string, SymbolInfo[]>;
  imports: Record<string, ImportInfo[]>;
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
    }[];
  };
}

export async function aggregateBySymbolsAndImports(
  query: QueryDslQueryContainer
): Promise<Record<string, FileSymbolsAndImports>> {
  const response = await client.search<unknown, FileAggregationWithImports>({
    index: indexName,
    query,
    aggs: {
      files: {
        terms: {
          field: 'filePath',
          size: 1000,
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
        .map(b => ({
          name: b.key,
          kind: b.kind.buckets[0].key,
          line: b.line.buckets[0].key,
        }))
        .reduce((acc, { kind, ...rest }) => {
          if (!acc[kind]) {
            acc[kind] = [];
          }
          acc[kind].push(rest);
          return acc;
        }, {} as Record<string, SymbolInfo[]>);

      const imports = bucket.imports.paths.buckets
        .map(b => ({
          path: b.key,
          type: b.type.buckets[0].key,
          symbols: b.symbols.buckets.map(s => s.key),
        }))
        .reduce((acc, { type, ...rest }) => {
          if (!acc[type]) {
            acc[type] = [];
          }
          acc[type].push(rest);
          return acc;
        }, {} as Record<string, ImportInfo[]>);
      results[filePath] = { symbols, imports };
    }
  }

  return results;
}
