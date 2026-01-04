import { z } from 'zod';
import { fromKueryExpression, toElasticsearchQuery } from '../../../libs/es-query';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { discoverSignificantDirectories, DirectoryInfo } from '../../elasticsearch/directory_discovery';
import { client, elasticsearchConfig, isIndexNotFoundError, formatIndexNotFoundError } from '../../utils/elasticsearch';
import { splitKqlNodeByStorage } from '../../utils/kql_scoping';
import { MAX_SEMANTIC_SEARCH_CANDIDATES } from '../../utils/limits';

const DiscoverDirectoriesInput = z.object({
  query: z.string().optional().describe('Semantic search query to filter relevant directories'),
  kql: z.string().optional().describe('KQL filter for additional filtering (e.g., "language: typescript")'),
  minFiles: z.number().optional().default(3).describe('Minimum number of files in directory (default: 3)'),
  maxResults: z.number().optional().default(20).describe('Maximum directories to return (default: 20)'),
  index: z.string().optional().describe('Elasticsearch index to search (optional)'),
});

export const discoverDirectoriesSchema = DiscoverDirectoriesInput;

export async function discoverDirectories(input: z.infer<typeof DiscoverDirectoriesInput>): Promise<CallToolResult> {
  // Parse with schema to apply defaults
  const params = DiscoverDirectoriesInput.parse(input);
  const index = params.index || elasticsearchConfig.index;

  const chunkMust: QueryDslQueryContainer[] = [];
  let locationQuery: QueryDslQueryContainer | undefined;

  if (params.query) {
    chunkMust.push({
      semantic: {
        field: 'semantic_text',
        query: params.query,
      },
    });
  }

  if (params.kql) {
    const ast = fromKueryExpression(params.kql);
    const split = splitKqlNodeByStorage(ast);
    if (split.chunkNode) {
      chunkMust.push(toElasticsearchQuery(split.chunkNode));
    }
    if (split.locationNode) {
      locationQuery = toElasticsearchQuery(split.locationNode);
    }
  }

  const chunkQuery = chunkMust.length > 0 ? ({ bool: { must: chunkMust } } as QueryDslQueryContainer) : undefined;

  try {
    const chunkIds =
      chunkQuery != null
        ? (
            await client.search({
              index,
              query: chunkQuery,
              size: MAX_SEMANTIC_SEARCH_CANDIDATES,
              _source: false,
            })
          ).hits.hits
            .map((h) => h._id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        : undefined;

    if (chunkQuery != null && (chunkIds?.length ?? 0) === 0) {
      return {
        content: [{ type: 'text', text: 'No significant directories found matching your criteria.' }],
      };
    }

    const directories = await discoverSignificantDirectories(client, index, {
      chunkIds,
      locationQuery,
      minFiles: params.minFiles,
      maxResults: params.maxResults,
    });

    return {
      content: [
        {
          type: 'text',
          text: formatDirectoryResults(directories),
        },
      ],
    };
  } catch (error) {
    if (isIndexNotFoundError(error)) {
      const errorMessage = await formatIndexNotFoundError(index);
      return {
        content: [{ type: 'text', text: errorMessage }],
        isError: true,
      };
    }
    throw error;
  }
}

function formatDirectoryResults(directories: DirectoryInfo[]): string {
  if (directories.length === 0) {
    return 'No significant directories found matching your criteria.';
  }

  let result = `Found ${directories.length} significant directories:\n\n`;

  for (const dir of directories) {
    result += `## ${dir.path}\n`;
    result += `- **Files**: ${dir.fileCount}\n`;
    result += `- **Symbols**: ${dir.symbolCount}\n`;
    result += `- **Languages**: ${dir.languages.join(', ')}\n`;
    result += `- **Score**: ${dir.score.toFixed(3)}\n`;
    result += `\n`;
  }

  return result;
}
