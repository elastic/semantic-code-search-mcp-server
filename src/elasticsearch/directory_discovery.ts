import { Client } from '@elastic/elasticsearch';
import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';

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
  symbol_count: { count: { value: number } };
  languages: { buckets: Array<{ key: string; doc_count: number }> };
  top_kinds: { buckets: Array<{ key: string; doc_count: number }> };
  score: { value: number };
}

interface DirectoryAggregationResponse {
  buckets: DirectoryAggregationBucket[];
}

export async function discoverSignificantDirectories(
  client: Client,
  index: string,
  options: {
    query?: QueryDslQueryContainer;
    minFiles?: number;
    maxResults?: number;
  }
): Promise<DirectoryInfo[]> {
  const response = await client.search({
    index,
    query: options.query || { match_all: {} },
    size: 0,
    aggs: {
      directories: {
        terms: {
          field: 'directoryPath',
          size: options.maxResults || 50,
          min_doc_count: options.minFiles || 3,
          order: { score: 'desc' }
        },
        aggs: {
          score: {
            avg: {
              script: { source: '_score' }
            }
          },
          file_count: {
            cardinality: { field: 'filePath' }
          },
          symbol_count: {
            nested: { path: 'symbols' },
            aggs: {
              count: { value_count: { field: 'symbols.name' } }
            }
          },
          languages: {
            terms: { field: 'language', size: 10 }
          },
          top_kinds: {
            terms: { field: 'kind', size: 5 }
          }
        }
      }
    }
  });

  const buckets = (response.aggregations?.directories as DirectoryAggregationResponse)?.buckets || [];
  
  return buckets.map(bucket => {
    return {
      path: bucket.key,
      fileCount: bucket.file_count.value,
      symbolCount: bucket.symbol_count.count.value,
      languages: bucket.languages.buckets.map(b => b.key),
      topKinds: bucket.top_kinds.buckets.map(b => b.key),
      score: bucket.score.value
    };
  });
}
