import { Client } from '@elastic/elasticsearch';
import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';

function getLocationsIndexName(index: string): string {
  return `${index}_locations`;
}

export interface DirectoryInfo {
  path: string;
  fileCount: number;
  symbolCount: number;
  languages: string[];
  topKinds: string[];
  score: number;
}

interface DirectoryAggregationBucket {
  key: string;
  doc_count: number;
  file_count: { value: number };
  top_chunks: { buckets: Array<{ key: string; doc_count: number }> };
}

interface DirectoryAggregationResponse {
  buckets: DirectoryAggregationBucket[];
}

/**
 * Discovers significant directories via `<alias>_locations` (one document per chunk occurrence).
 */
export async function discoverSignificantDirectories(
  client: Client,
  index: string,
  options: {
    chunkIds?: string[];
    locationQuery?: QueryDslQueryContainer;
    minFiles?: number;
    maxResults?: number;
  }
): Promise<DirectoryInfo[]> {
  const locationsIndex = getLocationsIndexName(index);
  const uniqueChunkIds = Array.from(new Set(options.chunkIds ?? [])).filter(
    (id) => typeof id === 'string' && id.length
  );

  const queryMust: QueryDslQueryContainer[] = [];
  if (options.locationQuery) {
    queryMust.push(options.locationQuery);
  }
  if (uniqueChunkIds.length > 0) {
    queryMust.push({ terms: { chunk_id: uniqueChunkIds } });
  }

  const response = await client.search({
    index: locationsIndex,
    query: queryMust.length > 0 ? { bool: { must: queryMust } } : { match_all: {} },
    size: 0,
    aggs: {
      directories: {
        terms: {
          field: 'directoryPath',
          size: options.maxResults || 50,
          min_doc_count: options.minFiles || 3,
          order: { _count: 'desc' },
        },
        aggs: {
          file_count: {
            cardinality: { field: 'filePath' },
          },
          top_chunks: {
            terms: {
              field: 'chunk_id',
              size: 200,
            },
          },
        },
      },
    },
  });

  const buckets = (response.aggregations as unknown as { directories?: DirectoryAggregationResponse })?.directories
    ?.buckets;

  const chunkIdsForEnrichment = Array.from(
    new Set((buckets ?? []).flatMap((b) => b.top_chunks?.buckets?.map((c) => c.key) ?? []))
  );
  const mgetResponse = await client.mget({
    index,
    ids: chunkIdsForEnrichment,
  });
  // Note: chunkIdsForEnrichment is bounded by (maxResults * 200) due to the `top_chunks` agg size.
  // Keep an eye on this if maxResults or top_chunks size increases.
  type ChunkEnrichment = { language: string; kind?: string; symbols?: Array<unknown> };
  const chunksById: Record<string, ChunkEnrichment> = {};
  for (const doc of mgetResponse.docs) {
    if (!('found' in doc) || !doc.found) continue;
    if (typeof doc._id !== 'string') continue;
    if (!doc._source) continue;
    chunksById[doc._id] = doc._source as ChunkEnrichment;
  }

  return (buckets ?? []).map((bucket) => {
    const bucketChunkIds = (bucket.top_chunks?.buckets ?? []).map((b) => b.key);
    const languages: Record<string, number> = {};
    const kinds: Record<string, number> = {};
    let symbolCount = 0;

    for (const id of bucketChunkIds) {
      const chunk = chunksById[id];
      if (!chunk) continue;
      languages[chunk.language] = (languages[chunk.language] ?? 0) + 1;
      if (chunk.kind) {
        kinds[chunk.kind] = (kinds[chunk.kind] ?? 0) + 1;
      }
      symbolCount += chunk.symbols?.length ?? 0;
    }

    const topKinds = Object.entries(kinds)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k);

    return {
      path: bucket.key,
      fileCount: bucket.file_count.value,
      symbolCount,
      languages: Object.keys(languages).slice(0, 10),
      topKinds,
      score: bucket.doc_count,
    };
  });
}
