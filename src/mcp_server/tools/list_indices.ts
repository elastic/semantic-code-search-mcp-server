import { z } from 'zod';
import { client } from '../../utils/elasticsearch';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { SearchRequest } from '@elastic/elasticsearch/lib/api/types';
import { elasticsearchConfig } from '../../config';

interface AggregationBucket {
  key: string;
  numberOfFiles: {
    value: number;
  };
}

interface Aggregations {
  filesIndexed: {
    value: number;
  };
  NumberOfSymbols: {
    total: {
      value: number;
    };
  };
  Languages: {
    buckets: AggregationBucket[];
  };
  Types: {
    buckets: AggregationBucket[];
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

export async function listIndices(): Promise<CallToolResult> {
  const aliasesResponse = await client.indices.getAlias({
    name: '*-repo',
  });

  if (!aliasesResponse || Object.keys(aliasesResponse).length === 0) {
    return {
      content: [{ type: 'text', text: 'No indices found matching the "*-repo" pattern.' }],
    };
  }

  const defaultIndexName = elasticsearchConfig.index;
  let result = '';
  const indexEntries = Object.entries(aliasesResponse);

  for (const [indexName, indexInfo] of indexEntries) {
    if (!indexInfo.aliases) continue;

    const repoAliases = Object.keys(indexInfo.aliases).filter(alias => alias.endsWith('-repo'));

    for (const alias of repoAliases) {
      const searchResponse = await client.search<unknown, Aggregations>({
        index: alias,
        ...aggregationQuery,
      });

      const aggregations = searchResponse.aggregations;

      if (!aggregations) {
        continue;
      }

      const filesIndexed = aggregations.filesIndexed.value;
      const numberOfSymbols = aggregations.NumberOfSymbols.total.value;
      const languages = aggregations.Languages.buckets
        .map((bucket: AggregationBucket) => `${bucket.key} (${formatNumber(bucket.numberOfFiles.value)} files)`)
        .join(', ');
      const types = aggregations.Types.buckets
        .map((bucket: AggregationBucket) => `${bucket.key} (${formatNumber(bucket.numberOfFiles.value)} files)`)
        .join(', ');

      const isDefault = indexName === defaultIndexName || alias === defaultIndexName;
      result += `Index: ${alias}${isDefault ? ' (Default)' : ''}\n`;
      result += `- Files: ${filesIndexed.toLocaleString()} total\n`;
      result += `- Symbols: ${numberOfSymbols.toLocaleString()} total\n`;
      result += `- Languages: ${languages}\n`;
      result += `- Content: ${types}\n`;

      // Check if it's not the last alias of the last index entry
      const isLastName = repoAliases.indexOf(alias) === repoAliases.length - 1;
      const isLastEntry = indexEntries.indexOf(indexEntries.find(entry => entry[0] === indexName)!) === indexEntries.length - 1;

      if (!isLastName || !isLastEntry) {
        result += '---\n';
      }
    }
  }
  return {
    content: [{ type: 'text', text: result.trim() }],
  };
}