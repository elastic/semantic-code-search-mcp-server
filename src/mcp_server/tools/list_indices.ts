import { z } from 'zod';
import { client } from '../../utils/elasticsearch';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { SearchRequest } from '@elastic/elasticsearch/lib/api/types';
import { elasticsearchConfig } from '../../config';

interface AggregationBucket {
  key: string;
  numberOfFiles?: {
    value?: number;
  };
}

interface Aggregations {
  filesIndexed?: {
    value?: number;
  };
  NumberOfSymbols?: {
    total?: {
      value?: number;
    };
  };
  Languages?: {
    buckets?: AggregationBucket[];
  };
  Types?: {
    buckets?: AggregationBucket[];
  };
}

export const listIndicesSchema = z.object({});

const aggregationQuery: SearchRequest = {
  size: 0,
  aggs: {
    filesIndexed: { cardinality: { field: 'filePath' } },
    NumberOfSymbols: {
      nested: { path: 'symbols' },
      aggs: { total: { cardinality: { field: 'symbols.name' } } },
    },
    Types: {
      terms: { field: 'type' },
      aggs: { numberOfFiles: { cardinality: { field: 'filePath' } } },
    },
    Languages: {
      terms: { field: 'language' },
      aggs: { numberOfFiles: { cardinality: { field: 'filePath' } } },
    },
  },
};

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

interface RepoIndexInfo {
  displayName: string; // The name to display in output (the index name, not alias)
  actualIndexName: string; // The actual index name to query in Elasticsearch
  isDefault: boolean;
}

async function discoverRepoIndicesFromAliases(): Promise<RepoIndexInfo[]> {
  const repoIndices: RepoIndexInfo[] = [];
  const defaultIndexName = elasticsearchConfig.index;

  try {
    const aliasesResponse = await client.indices.getAlias({
      name: '*-repo',
    });

    if (aliasesResponse && Object.keys(aliasesResponse).length > 0) {
      const indexEntries = Object.entries(aliasesResponse);

      for (const [indexName, indexInfo] of indexEntries) {
        if (!indexInfo.aliases) continue;

        const repoAliases = Object.keys(indexInfo.aliases).filter((alias) => alias.endsWith('-repo'));

        for (const alias of repoAliases) {
          repoIndices.push({
            displayName: indexName, // Show the actual index name, not the alias
            actualIndexName: indexName, // Use underlying index name for deduplication
            isDefault: indexName === defaultIndexName || alias === defaultIndexName,
          });
        }
      }
    }
  } catch (error) {
    // If alias query fails, continue to fallback method
    console.warn('Failed to query aliases:', error);
  }

  return repoIndices;
}

async function discoverRepoIndicesFromSettings(): Promise<RepoIndexInfo[]> {
  const repoIndices: RepoIndexInfo[] = [];
  const defaultIndexName = elasticsearchConfig.index;

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
            repoIndices.push({
              displayName: baseIndexName,
              actualIndexName: baseIndexName,
              isDefault: baseIndexName === defaultIndexName,
            });
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

export async function listIndices(): Promise<CallToolResult> {
  // Strategy 1: Discover from aliases
  const aliasIndices = await discoverRepoIndicesFromAliases();

  // Strategy 2: Discover from _settings indices (fallback)
  const settingsIndices = await discoverRepoIndicesFromSettings();

  // Merge and deduplicate by actualIndexName (the index we query)
  // We prefer the alias-based index if it exists, as it's the "official" entry point
  const deduplicatedIndicesMap = new Map<string, RepoIndexInfo>();

  // Add alias-based indices first (they take precedence)
  for (const repoIndex of aliasIndices) {
    deduplicatedIndicesMap.set(repoIndex.actualIndexName, repoIndex);
  }

  // Add settings-based indices only if not already found via aliases
  for (const repoIndex of settingsIndices) {
    if (!deduplicatedIndicesMap.has(repoIndex.actualIndexName)) {
      deduplicatedIndicesMap.set(repoIndex.actualIndexName, repoIndex);
    }
  }

  const allRepoIndices = Array.from(deduplicatedIndicesMap.values());

  if (allRepoIndices.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No indices found. Searched for aliases ending with "-repo" and indices ending with "_settings".',
        },
      ],
    };
  }

  // Sort by display name for consistent output
  allRepoIndices.sort((a, b) => a.displayName.localeCompare(b.displayName));

  let result = '';
  for (let i = 0; i < allRepoIndices.length; i++) {
    const repoIndex = allRepoIndices[i];

    try {
      const searchResponse = await client.search<unknown, Aggregations>({
        index: repoIndex.actualIndexName,
        ...aggregationQuery,
      });

      const aggregations = searchResponse.aggregations;

      if (!aggregations) {
        continue;
      }

      // Handle potentially missing aggregation values (Elasticsearch can return partial data)
      const filesIndexed = aggregations.filesIndexed?.value ?? 0;
      const numberOfSymbols = aggregations.NumberOfSymbols?.total?.value ?? 0;
      const languages = (aggregations.Languages?.buckets ?? [])
        .map((bucket: AggregationBucket) => `${bucket.key} (${formatNumber(bucket.numberOfFiles?.value ?? 0)} files)`)
        .join(', ');
      const types = (aggregations.Types?.buckets ?? [])
        .map((bucket: AggregationBucket) => `${bucket.key} (${formatNumber(bucket.numberOfFiles?.value ?? 0)} files)`)
        .join(', ');

      result += `Index: ${repoIndex.displayName}${repoIndex.isDefault ? ' (Default)' : ''}\n`;
      result += `- Files: ${filesIndexed.toLocaleString()} total\n`;
      result += `- Symbols: ${numberOfSymbols.toLocaleString()} total\n`;
      result += `- Languages: ${languages || 'none'}\n`;
      result += `- Content: ${types || 'none'}\n`;

      // Add separator if not the last item
      if (i < allRepoIndices.length - 1) {
        result += '---\n';
      }
    } catch (error) {
      // Skip indices we can't query
      console.warn(`Failed to query index ${repoIndex.actualIndexName}:`, error);
      continue;
    }
  }

  return {
    content: [{ type: 'text', text: result.trim() }],
  };
}
