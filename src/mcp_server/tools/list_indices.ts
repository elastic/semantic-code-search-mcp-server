import { z } from 'zod';
import { client, getLocationsIndexName } from '../../utils/elasticsearch';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { SearchRequest } from '@elastic/elasticsearch/lib/api/types';
import { elasticsearchConfig } from '../../config';

interface AggregationBucket {
  key: string;
  doc_count: number;
}

interface Aggregations {
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

const LOCATIONS_ALIAS_SUFFIX = '_locations';

const aggregationQuery: SearchRequest = {
  size: 0,
  aggs: {
    NumberOfSymbols: {
      nested: { path: 'symbols' },
      aggs: { total: { cardinality: { field: 'symbols.name' } } },
    },
    Types: {
      terms: { field: 'type' },
    },
    Languages: {
      terms: { field: 'language' },
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

function getErrorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const typedError = error as { meta?: { statusCode?: unknown } };
  if (typedError.meta && typeof typedError.meta.statusCode === 'number') {
    return typedError.meta.statusCode;
  }

  return undefined;
}

export async function listIndices(): Promise<CallToolResult> {
  let aliasesResponse: Record<string, { aliases?: Record<string, unknown> }> = {};
  try {
    aliasesResponse = (await client.indices.getAlias({
      name: `*${LOCATIONS_ALIAS_SUFFIX}`,
    })) as unknown as Record<string, { aliases?: Record<string, unknown> }>;
  } catch (error: unknown) {
    // Elasticsearch returns 404 when no aliases match.
    if (getErrorStatusCode(error) !== 404) {
      throw error;
    }
  }

  if (!aliasesResponse || Object.keys(aliasesResponse).length === 0) {
    return {
      content: [
        {
          type: 'text',
          text:
            'No semantic code search indices found.\n' +
            `Expected to find aliases matching "*${LOCATIONS_ALIAS_SUFFIX}" (e.g. "<alias>${LOCATIONS_ALIAS_SUFFIX}") in Elasticsearch.`,
        },
      ],
    };
  }

  const defaultIndexName = elasticsearchConfig.index;
  const blocks: string[] = [];

  const locationAliases = new Set<string>();
  for (const [, indexInfo] of Object.entries(aliasesResponse)) {
    if (!indexInfo.aliases) continue;
    for (const alias of Object.keys(indexInfo.aliases)) {
      if (alias.endsWith(LOCATIONS_ALIAS_SUFFIX)) {
        locationAliases.add(alias);
      }
    }
  }

  const baseAliases = Array.from(locationAliases)
    .map((a) => a.slice(0, -LOCATIONS_ALIAS_SUFFIX.length))
    .filter((a) => a.length > 0)
    .sort((a, b) => a.localeCompare(b));

  for (const alias of baseAliases) {
    const locationsIndex = getLocationsIndexName(alias);
    const fileCountResponse = await client.search({
      index: locationsIndex,
      size: 0,
      aggs: {
        filesIndexed: { cardinality: { field: 'filePath' } },
      },
    });
    const filesIndexedAgg = fileCountResponse.aggregations as { filesIndexed?: { value?: number } } | undefined;
    const filesIndexed = filesIndexedAgg?.filesIndexed?.value ?? 0;

    const searchResponse = await client.search<unknown, Omit<Aggregations, 'filesIndexed'>>({
      index: alias,
      ...aggregationQuery,
    });

    const aggregations = searchResponse.aggregations;

    if (!aggregations) {
      continue;
    }

    const numberOfSymbols = aggregations.NumberOfSymbols.total.value;
    const languages = aggregations.Languages.buckets
      .map((bucket: AggregationBucket) => `${bucket.key} (${formatNumber(bucket.doc_count)} chunks)`)
      .join(', ');
    const types = aggregations.Types.buckets
      .map((bucket: AggregationBucket) => `${bucket.key} (${formatNumber(bucket.doc_count)} chunks)`)
      .join(', ');

    const isDefault = alias === defaultIndexName;
    blocks.push(
      `Index: ${alias}${isDefault ? ' (Default)' : ''}\n` +
        `- Files: ${filesIndexed.toLocaleString()} total\n` +
        `- Symbols: ${numberOfSymbols.toLocaleString()} total\n` +
        `- Languages: ${languages}\n` +
        `- Content: ${types}\n`
    );
  }

  if (blocks.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text:
            'No semantic code search indices found (or accessible).\n' +
            `Found aliases matching "*${LOCATIONS_ALIAS_SUFFIX}", but could not query expected aggregations.`,
        },
      ],
    };
  }

  const result = blocks.join('---\n').trim();
  return {
    content: [{ type: 'text', text: result.trim() }],
  };
}
