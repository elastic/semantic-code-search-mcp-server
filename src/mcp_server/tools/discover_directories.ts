import { z } from 'zod';
import { fromKueryExpression, toElasticsearchQuery } from '../../../libs/es-query';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { discoverSignificantDirectories, DirectoryInfo } from '../../elasticsearch/directory_discovery';
import { client, elasticsearchConfig, isIndexNotFoundError, formatIndexNotFoundError } from '../../utils/elasticsearch';

const DiscoverDirectoriesInput = z.object({
  query: z.string().optional().describe('Semantic search query to filter relevant directories'),
  kql: z.string().optional().describe('KQL filter for additional filtering (e.g., "language: typescript")'),
  minFiles: z.number().optional().default(3).describe('Minimum number of files in directory (default: 3)'),
  maxResults: z.number().optional().default(20).describe('Maximum directories to return (default: 20)'),
  index: z.string().optional().describe('Elasticsearch index to search (optional)')
});

export const discoverDirectoriesSchema = DiscoverDirectoriesInput;

export async function discoverDirectories(
  input: z.infer<typeof DiscoverDirectoriesInput>
): Promise<CallToolResult> {
  // Parse with schema to apply defaults
  const params = DiscoverDirectoriesInput.parse(input);
  const index = params.index || elasticsearchConfig.index;
  
  // Build Elasticsearch query
  const must: QueryDslQueryContainer[] = [];
  
  if (params.query) {
    must.push({
      semantic: {
        field: 'semantic_text',
        query: params.query
      }
    });
  }
  
  if (params.kql) {
    // Parse KQL and combine with semantic query
    const ast = fromKueryExpression(params.kql);
    const kqlQuery = toElasticsearchQuery(ast);
    must.push(kqlQuery);
  }
  
  const esQuery = must.length > 0 ? { bool: { must } } : undefined;
  
  try {
    const directories = await discoverSignificantDirectories(client, index, {
      query: esQuery,
      minFiles: params.minFiles,
      maxResults: params.maxResults
    });
    
    return {
      content: [
        {
          type: 'text',
          text: formatDirectoryResults(directories)
        }
      ]
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
