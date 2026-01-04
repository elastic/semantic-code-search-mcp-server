import { z } from 'zod';
import { readFile } from './read_file';
import { mapSymbolsByQuery } from './map_symbols_by_query';
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

interface MapSymbolsByQueryResult {
  [filePath: string]: {
    symbols?: Record<string, Array<{ name: string; line: number }>>;
    // imports/exports are intentionally ignored for this tool
  };
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

  // If there's an error, pass it through
  if (reconstructedFile.isError) {
    return reconstructedFile;
  }

  const reconstructedContent =
    typeof reconstructedFile.content[0]?.text === 'string' ? reconstructedFile.content[0].text : '';

  // 2. Get all the symbols in the file
  const allSymbolsResult = await mapSymbolsByQuery({ kql: `filePath: "${filePath}"`, index, size: 1000 });

  // If there's an error, pass it through
  if (allSymbolsResult.isError) {
    return allSymbolsResult;
  }

  const rawText = allSymbolsResult.content[0]?.text;
  const allSymbols: MapSymbolsByQueryResult = typeof rawText === 'string' ? JSON.parse(rawText) : {};
  const symbolsForFile = allSymbols[filePath]?.symbols ?? {};

  const flattenedSymbols: Symbol[] = Object.entries(symbolsForFile).flatMap(([kind, entries]) =>
    entries.map((entry) => ({ name: entry.name, kind, line: entry.line }))
  );

  // 3. Identify the important symbols
  const importantSymbols = flattenedSymbols.filter((symbol: Symbol) => {
    return reconstructedContent.includes(symbol.name);
  });

  // 4. Format the results
  const formattedSymbols = importantSymbols.map((symbol: Symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    line: symbol.line,
  }));

  return {
    content: [{ type: 'text', text: JSON.stringify(formattedSymbols, null, 2) }],
  };
}
