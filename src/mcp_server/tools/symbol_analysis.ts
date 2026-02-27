import { z } from 'zod';
import { fromKueryExpression, toElasticsearchQuery } from '../../../libs/es-query';
import {
  client,
  elasticsearchConfig,
  formatIndexNotFoundError,
  getChunksById,
  getLocationsIndexName,
  isIndexNotFoundError,
} from '../../utils/elasticsearch';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';

/**
 * @interface SymbolAnalysisReport
 * @description Defines the structure of the symbol analysis report.
 * @property {FileInfo[]} primaryDefinitions - A list of files containing primary definitions of the symbol.
 * @property {FileInfo[]} typeDefinitions - A list of files containing type definitions of the symbol.
 * @property {FileInfo[]} executionCallSites - A list of files containing call sites of the symbol.
 * @property {FileInfo[]} importReferences - A list of files containing import references to the symbol.
 * @property {FileInfo[]} documentation - A list of files containing documentation for the symbol.
 */
interface SymbolAnalysisReport {
  primaryDefinitions: FileInfo[];
  typeDefinitions: FileInfo[];
  executionCallSites: FileInfo[];
  importReferences: FileInfo[];
  documentation: FileInfo[];
}

/**
 * @interface KindInfo
 * @description Defines the structure of the kind information for a symbol.
 * @property {string} kind - The kind of the symbol (e.g., 'function_declaration', 'class_declaration').
 * @property {number[]} startLines - An array of line numbers where the symbol is defined.
 */
interface KindInfo {
  kind: string;
  startLines: number[];
}

/**
 * @interface FileInfo
 * @description Defines the structure of the file information for a symbol.
 * @property {string} filePath - The path to the file.
 * @property {KindInfo[]} kinds - An array of kind information for the symbol.
 * @property {string[]} languages - An array of languages the file is written in.
 */
interface FileInfo {
  filePath: string;
  kinds: KindInfo[];
  languages: string[];
}

/**
 * The Zod schema for the `symbolAnalysis` tool.
 * @property {string} symbolName - The name of the symbol to analyze.
 */
export const symbolAnalysisSchema = z.object({
  symbolName: z.string().describe('The name of the symbol to analyze.'),
  index: z.string().optional().describe('The Elasticsearch index to search.'),
});

export type SymbolAnalysisParams = z.infer<typeof symbolAnalysisSchema>;

/**
 * Analyzes a symbol and returns a report of its definitions, call sites, and references.
 *
 * This function uses an Elasticsearch aggregation to gather information about a
 * symbol from the index.
 *
 * @param {SymbolAnalysisParams} params - The parameters for the function.
 * @returns {Promise<CallToolResult>} A promise that resolves to a
 * `CallToolResult` object containing the symbol analysis report.
 */
/**
 * Analyzes a symbol and returns a report of its definitions, call sites, and references.
 *
 * This function uses an Elasticsearch aggregation to gather information about a
 * symbol from the index.
 *
 * @param {SymbolAnalysisParams} params - The parameters for the function.
 * @returns {Promise<CallToolResult>} A promise that resolves to a
 * `CallToolResult` object containing the symbol analysis report.
 */
export async function symbolAnalysis(params: SymbolAnalysisParams): Promise<CallToolResult> {
  const { symbolName, index } = params;
  const baseIndex = index || elasticsearchConfig.index;
  const locationsIndex = getLocationsIndexName(baseIndex);
  const kql = `content: "${symbolName}"`;

  const ast = fromKueryExpression(kql);
  const dsl = toElasticsearchQuery(ast);

  try {
    const chunkHits = await client.search({
      index: baseIndex,
      query: dsl,
      size: 5000,
      _source: false,
    });

    const chunkIds = chunkHits.hits.hits
      .map((h) => h._id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    const report: SymbolAnalysisReport = {
      primaryDefinitions: [],
      typeDefinitions: [],
      executionCallSites: [],
      importReferences: [],
      documentation: [],
    };

    if (chunkIds.length === 0) {
      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    }

    const response = await client.search({
      index: locationsIndex,
      query: { terms: { chunk_id: chunkIds } },
      size: 0,
      aggs: {
        files: {
          terms: {
            field: 'filePath',
            size: 1000,
          },
          aggs: {
            chunks: {
              terms: {
                field: 'chunk_id',
                size: 2000,
              },
              aggs: {
                startLine: {
                  top_hits: {
                    size: 1,
                    _source: ['startLine'],
                    sort: [{ startLine: { order: 'asc' } }],
                  },
                },
              },
            },
          },
        },
      },
    });

    const buckets = (
      response.aggregations as unknown as {
        files?: {
          buckets?: Array<{
            key: string;
            chunks?: {
              buckets?: Array<{ key: string; startLine?: { hits?: { hits?: Array<{ _source?: unknown }> } } }>;
            };
          }>;
        };
      }
    )?.files?.buckets;

    const allChunkIds = Array.from(new Set((buckets ?? []).flatMap((b) => b.chunks?.buckets?.map((c) => c.key) ?? [])));
    const chunksById = await getChunksById(allChunkIds, { index: baseIndex });

    for (const bucket of buckets ?? []) {
      const filePath = bucket.key;
      const kindsByName: Record<string, number[]> = {};
      const languagesSet = new Set<string>();

      for (const c of bucket.chunks?.buckets ?? []) {
        const chunk = chunksById[c.key];
        if (!chunk) continue;
        languagesSet.add(chunk.language);
        const kind = chunk.kind ?? 'chunk';

        const startLine = (c.startLine?.hits?.hits?.[0]?._source as { startLine?: unknown } | undefined)?.startLine;
        const line = typeof startLine === 'number' ? startLine : 0;
        if (!kindsByName[kind]) kindsByName[kind] = [];
        kindsByName[kind].push(line);
      }

      const kinds: KindInfo[] = Object.entries(kindsByName).map(([kind, startLines]) => ({
        kind,
        startLines,
      }));
      const languages = Array.from(languagesSet);

      const fileInfo: FileInfo = {
        filePath,
        kinds,
        languages,
      };

      const allKinds = kinds.map((k) => k.kind);

      if (
        allKinds.includes('function_declaration') ||
        allKinds.includes('class_declaration') ||
        allKinds.includes('lexical_declaration')
      ) {
        report.primaryDefinitions.push(fileInfo);
      }
      if (
        allKinds.includes('interface_declaration') ||
        allKinds.includes('type_alias_declaration') ||
        allKinds.includes('enum_declaration')
      ) {
        report.typeDefinitions.push(fileInfo);
      }
      if (allKinds.includes('call_expression')) {
        report.executionCallSites.push(fileInfo);
      }
      if (allKinds.includes('import_statement')) {
        report.importReferences.push(fileInfo);
      }
      if (languages.includes('markdown') || allKinds.includes('comment')) {
        report.documentation.push(fileInfo);
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
    };
  } catch (error) {
    if (isIndexNotFoundError(error)) {
      const errorMessage = await formatIndexNotFoundError(index || elasticsearchConfig.index);
      return {
        content: [{ type: 'text', text: errorMessage }],
        isError: true,
      };
    }
    throw error;
  }
}
