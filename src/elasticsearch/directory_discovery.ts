import { Client } from '@elastic/elasticsearch';
import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';

export interface DirectoryInfo {
  path: string;
  fileCount: number;
  symbolCount: number;
  languages: string[];
  topKinds: string[];
  boundaryMarkerFiles: string[];
  significance: number;
}

interface DirectoryAggregationBucket {
  key: string;
  doc_count: number;
  file_count: { value: number };
  symbol_count: { count: { value: number } };
  languages: { buckets: Array<{ key: string; doc_count: number }> };
  top_kinds: { buckets: Array<{ key: string; doc_count: number }> };
  sample_files: { buckets: Array<{ key: string }> };
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
          min_doc_count: options.minFiles || 3
        },
        aggs: {
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
          },
          sample_files: {
            terms: { 
              field: 'filePath',
              size: 5,
              include: '.*/(README|package\\.json|tsconfig\\.json|index\\.|go\\.mod|Cargo\\.toml|__init__\\.py).*'
            }
          }
        }
      }
    }
  });

  const buckets = (response.aggregations?.directories as DirectoryAggregationResponse)?.buckets || [];
  
  return buckets.map(bucket => {
    const languageCount = bucket.languages.buckets.length;
    const boundaryMarkers = extractBoundaryMarkers(bucket.sample_files.buckets);
    
    return {
      path: bucket.key,
      fileCount: bucket.file_count.value,
      symbolCount: bucket.symbol_count.count.value,
      languages: bucket.languages.buckets.map(b => b.key),
      topKinds: bucket.top_kinds.buckets.map(b => b.key),
      boundaryMarkerFiles: boundaryMarkers,
      significance: calculateSignificance({
        fileCount: bucket.file_count.value,
        symbolCount: bucket.symbol_count.count.value,
        languageCount,
        boundaryMarkerCount: boundaryMarkers.length
      })
    };
  }).sort((a, b) => b.significance - a.significance);
}

function extractBoundaryMarkers(fileBuckets: Array<{ key: string }>): string[] {
  const MARKERS = [
    'README.md', 'README.mdx', 'package.json', 'tsconfig.json',
    'index.ts', 'index.js', 'index.tsx', 'go.mod', 'Cargo.toml', '__init__.py'
  ];
  
  return fileBuckets
    .map(b => b.key.split('/').pop() || '')
    .filter(filename => MARKERS.some(marker => 
      filename === marker || filename.startsWith('index.')
    ));
}

export function calculateSignificance(params: {
  fileCount: number;
  symbolCount: number;
  languageCount: number;
  boundaryMarkerCount: number;
}): number {
  const { fileCount, symbolCount, languageCount, boundaryMarkerCount } = params;
  
  // Boundary marker bonuses
  const boundaryBonus = boundaryMarkerCount * 10.0;
  
  // Base calculation
  return (
    (fileCount * 2.0) +
    (symbolCount * 0.1) +
    (languageCount * 3.0) +
    boundaryBonus
  );
}
