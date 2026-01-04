import { z } from 'zod';
import {
  client,
  elasticsearchConfig,
  isIndexNotFoundError,
  formatIndexNotFoundError,
  getChunksById,
  getLocationsIndexName,
} from '../../utils/elasticsearch';
import { Sort } from '@elastic/elasticsearch/lib/api/types';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';

/**
 * The Zod schema for the `readFile` tool.
 * @property {string[]} filePaths - An array of one or more file paths (typically repository-relative) to read.
 */
export const readFileSchema = z.object({
  filePaths: z.array(z.string()).nonempty(),
  index: z.string().optional().describe('The Elasticsearch index to search.'),
});

/**
 * @interface CodeChunkHit
 * @description Defines the structure of a search hit from Elasticsearch, including the source document and sort values.
 */
interface LocationHit {
  _id: string;
  _source: {
    chunk_id: string;
    filePath: string;
    startLine: number;
    endLine: number;
  };
  sort: (string | number)[];
}

interface ReconstructedChunk {
  content: string;
  startLine: number;
  endLine: number;
  kind: string;
}

const MISSING_CHUNK_ID_SAMPLE_SIZE = 5;

/**
 * Reads the content of a file from the index, providing a reconstructed view
 * based on the most important indexed chunks. This function uses Elasticsearch's
 * `search_after` feature to paginate through all relevant chunks for the given file paths.
 *
 * @param {object} params - The parameters for the function.
 * @param {string[]} params.filePaths - An array of one or more file paths (typically repository-relative) to read.
 * @returns {Promise<CallToolResult>} A promise that resolves to a CallToolResult containing the reconstructed file content,
 * formatted for the MCP server.
 */
export async function readFile({ filePaths, index }: z.infer<typeof readFileSchema>): Promise<CallToolResult> {
  const { index: defaultIndex } = elasticsearchConfig;
  const baseIndex = index || defaultIndex;
  const locationsIndex = getLocationsIndexName(baseIndex);

  try {
    const reconstructedFiles: { [filePath: string]: string } = {};

    for (const requestedFilePath of filePaths) {
      const allLocationsForFile: LocationHit[] = [];
      let searchAfter: (string | number)[] | undefined = undefined;

      const sort: Sort = [{ startLine: 'asc' }, { endLine: 'desc' }, { chunk_id: 'asc' }];

      while (true) {
        const response = await client.search({
          index: locationsIndex,
          size: 1000, // Fetch in batches of 1000
          _source: ['chunk_id', 'filePath', 'startLine', 'endLine'],
          query: {
            term: { filePath: requestedFilePath },
          },
          sort,
          search_after: searchAfter,
        });

        const hits = response.hits.hits as LocationHit[];
        if (hits.length === 0) {
          break; // No more results, exit the loop
        }

        allLocationsForFile.push(...hits);
        searchAfter = hits[hits.length - 1].sort; // Get the sort values of the last document
      }

      if (allLocationsForFile.length === 0) {
        reconstructedFiles[requestedFilePath] =
          '// File not found in index.\n// No location documents found for this file path; the file may not be indexed or the path may be incorrect.';
        continue;
      }

      const uniqueChunkIds = Array.from(
        new Set(allLocationsForFile.map((h) => h._source.chunk_id).filter((id) => typeof id === 'string' && id.length))
      );
      const chunksById = await getChunksById(uniqueChunkIds, { index: baseIndex });
      const missingChunkIds = uniqueChunkIds.filter((id) => !chunksById[id]);

      const effectiveChunks = allLocationsForFile
        .map((hit) => {
          const chunk = chunksById[hit._source.chunk_id];
          if (!chunk) return null;
          return {
            content: chunk.content,
            kind: chunk.kind ?? 'chunk',
            startLine: hit._source.startLine,
            endLine: hit._source.endLine,
            chunk_id: hit._source.chunk_id,
          };
        })
        .filter(
          (v): v is { content: string; kind: string; startLine: number; endLine: number; chunk_id: string } => v != null
        );

      effectiveChunks.sort((a, b) => {
        if (a.startLine !== b.startLine) return a.startLine - b.startLine;
        if (a.endLine !== b.endLine) return b.endLine - a.endLine;
        return a.chunk_id.localeCompare(b.chunk_id);
      });

      // With the sort order (startLine asc, endLine desc), we can do a simple
      // filter to remove chunks that are completely contained within a previous one.
      const dedupedChunks: ReconstructedChunk[] = [];
      let lastEndLine = -1;

      for (const chunk of effectiveChunks) {
        if (chunk.endLine > lastEndLine) {
          dedupedChunks.push({
            content: chunk.content,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            kind: chunk.kind,
          });
          lastEndLine = chunk.endLine;
        }
      }

      let reconstructedContent = '';
      let currentLine = 1;

      if (missingChunkIds.length > 0) {
        reconstructedContent += `// Warning: ${missingChunkIds.length} location(s) reference chunk_id(s) missing in the primary index.\n`;
        reconstructedContent += `// Missing chunk_id sample: ${missingChunkIds.slice(0, MISSING_CHUNK_ID_SAMPLE_SIZE).join(', ')}\n\n`;
      }

      for (const chunk of dedupedChunks) {
        const gap = chunk.startLine - currentLine;

        if (reconstructedContent.length > 0) {
          // Not the first chunk
          if (gap > 0) {
            reconstructedContent += `\n// (${gap} lines omitted)\n`;
          } else if (gap === 0) {
            reconstructedContent += '\n';
          }
          // if gap < 0, it's an overlap, we just append. The dedupe logic should handle this.
        } else {
          // First chunk
          if (gap > 0) {
            // file doesn't start at line 1
            reconstructedContent += `// (${gap} lines omitted)\n`;
          }
        }

        reconstructedContent += chunk.content;
        currentLine = chunk.endLine + 1;
      }

      reconstructedFiles[requestedFilePath] = reconstructedContent;
    }

    const content = Object.entries(reconstructedFiles).map(([filePath, fileContent]) => ({
      type: 'text' as const,
      text: `File: ${filePath}\n\n${fileContent}`,
    }));

    return {
      content,
    };
  } catch (error) {
    if (isIndexNotFoundError(error)) {
      const errorMessage = await formatIndexNotFoundError(index || defaultIndex);
      return {
        content: [{ type: 'text', text: errorMessage }],
        isError: true,
      };
    }
    throw error;
  }
}
