import { z } from 'zod';
import { client } from '../../utils/elasticsearch';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { SearchRequest } from '@elastic/elasticsearch/lib/api/types';

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

  const aliases = Object.values(aliasesResponse)
    .flatMap(indexInfo => (indexInfo.aliases ? Object.keys(indexInfo.aliases) : []))
    .filter(alias => alias.endsWith('-repo'));

  if (aliases.length === 0) {
    return {
      content: [{ type: 'text', text: 'No aliases ending in "-repo" found for the matching indices.' }],
    };
  }

  let result = '';

  for (const alias of aliases) {
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

    result += `Index: ${alias}\n`;
    result += `- Files: ${filesIndexed.toLocaleString()} total\n`;
    result += `- Symbols: ${numberOfSymbols.toLocaleString()} total\n`;
    result += `- Languages: ${languages}\n`;
    result += `- Content: ${types}\n`;
    if (aliases.indexOf(alias) < aliases.length - 1) {
      result += '---\n';
    }
  }
  return {
    content: [{ type: 'text', text: result.trim() }],
  };
}