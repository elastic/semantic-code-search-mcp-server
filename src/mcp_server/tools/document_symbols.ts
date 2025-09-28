import { z } from 'zod';
import { readFile } from './read_file';
import { listSymbolsByQuery } from './list_symbols_by_query';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';

/**
 * The Zod schema for the `documentSymbols` tool.
 * @property {string} filePath - The absolute path to the file to analyze.
 */
export const documentSymbolsSchema = z.object({
  filePath: z.string(),
  index: z.string().optional().describe('The Elasticsearch index to search.'),
});

export type DocumentSymbolsParams = z.infer<typeof documentSymbolsSchema>;

interface Symbol {
  name: string;
  kind: string;
  line: number;
}

/**
 * Analyzes a file to identify the key symbols that would most benefit from
 * documentation.
 *
 * @param {DocumentSymbolsParams} params - The parameters for the function.
 * @returns {Promise<CallToolResult>} A promise that resolves to a
 * `CallToolResult` object containing the list of key symbols to document.
 */
export async function documentSymbols(params: DocumentSymbolsParams): Promise<CallToolResult> {
  const { filePath, index } = params;

  // 1. Get the reconstructed file content
  const reconstructedFile = await readFile({ filePaths: [filePath], index });
  const reconstructedContent = reconstructedFile.content[0].text;

  // 2. Get all the symbols in the file
  const allSymbolsResult = await listSymbolsByQuery({ kql: `filePath: "${filePath}"`, index });
  const allSymbols = JSON.parse(allSymbolsResult.content[0].text as string);
  const symbolsForFile = allSymbols[filePath] || [];

  // 3. Identify the important symbols
  const importantSymbols = symbolsForFile.filter((symbol: Symbol) => {
    return reconstructedContent.includes(symbol.name);
  });

  // 4. Format the results
  const formattedSymbols = importantSymbols.map((symbol: Symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    line: symbol.line,
  }));

  return {
    content: [{ type: 'text', text: JSON.stringify(formattedSymbols, null, 2) }]
  };
}
