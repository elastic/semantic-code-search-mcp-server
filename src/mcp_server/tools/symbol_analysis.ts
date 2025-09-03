import { z } from 'zod';
import { fromKueryExpression, toElasticsearchQuery } from '../../../libs/es-query';
import { client } from '../../utils/elasticsearch'; // Assuming client is exported from here
import { elasticsearchConfig } from '../../config';
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
interface SymbolAggregation {
  files: {
    buckets: {
      key: string;
      languages: {
        buckets: {
          key: string;
        }[];
      };
      kinds: {
        buckets: {
          key: string;
          startLines: {
            buckets: {
              key: number;
            }[];
          };
        }[];
      };
    }[];
  };
}

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
  const { symbolName } = params;
  const kql = `content: "${symbolName}"`;

  const ast = fromKueryExpression(kql);
  const dsl = toElasticsearchQuery(ast);

  const response = await client.search<unknown, SymbolAggregation>({
    index: elasticsearchConfig.index,
    query: dsl,
    aggs: {
      files: {
        terms: {
          field: 'filePath',
          size: 1000,
        },
        aggs: {
          kinds: {
            terms: {
              field: 'kind',
              size: 100,
            },
            aggs: {
              startLines: {
                terms: {
                  field: 'startLine',
                  size: 100,
                },
              },
            },
          },
          languages: {
            terms: {
              field: 'language',
              size: 10,
            },
          },
        },
      },
    },
    size: 0,
  });

  const report: SymbolAnalysisReport = {
    primaryDefinitions: [],
    typeDefinitions: [],
    executionCallSites: [],
    importReferences: [],
    documentation: [],
  };

  if (response.aggregations) {
    const files = response.aggregations;
    for (const bucket of files.files.buckets) {
      const filePath = bucket.key;
      const languages = bucket.languages.buckets.map(b => b.key);
      const kinds: KindInfo[] = bucket.kinds.buckets.map(b => ({
        kind: b.key,
        startLines: b.startLines.buckets.map(sl => sl.key),
      }));

      const fileInfo: FileInfo = {
        filePath,
        kinds,
        languages,
      };

      const allKinds = kinds.map(k => k.kind);

      if (allKinds.includes('function_declaration') || allKinds.includes('class_declaration') || allKinds.includes('lexical_declaration')) {
        report.primaryDefinitions.push(fileInfo);
      }
      if (allKinds.includes('interface_declaration') || allKinds.includes('type_alias_declaration') || allKinds.includes('enum_declaration')) {
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
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(report, null, 2) }]
  };
}
