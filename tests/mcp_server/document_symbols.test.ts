import { documentSymbols } from '../../src/mcp_server/tools/document_symbols';
import * as readFileTool from '../../src/mcp_server/tools/read_file';
import * as listSymbolsByQueryTool from '../../src/mcp_server/tools/list_symbols_by_query';

jest.mock('../../src/utils/elasticsearch', () => ({
  elasticsearchConfig: {
    index: 'semantic-code-search',
  },
}));
jest.mock('../../src/mcp_server/tools/read_file');
jest.mock('../../src/mcp_server/tools/list_symbols_by_query');

describe('document_symbols', () => {
  it('should return a list of important symbols to document', async () => {
    const filePath = 'src/mcp_server/tools/semantic_code_search.ts';

    (readFileTool.readFile as jest.Mock).mockResolvedValue({
      content: [{
        type: 'text',
        text: `
          const semanticCodeSearchSchema = z.object({});
          async function semanticCodeSearch(params: any) {
            const { query, kql, page, size } = params;
            const must = [];
            const ast = fromKueryExpression(kql);
            const dsl = toElasticsearchQuery(ast);
            const esQuery = { bool: { must } };
            const response = await client.search({});
          }
        `,
      }],
    });

    (listSymbolsByQueryTool.listSymbolsByQuery as jest.Mock).mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          [filePath]: [
            { name: 'semanticCodeSearchSchema', kind: 'variable', line: 10 },
            { name: 'semanticCodeSearch', kind: 'function', line: 20 },
            { name: 'someOtherSymbol', kind: 'variable', line: 30 },
          ],
        }),
      }],
    });

    const result = await documentSymbols({ filePath });
    const symbols = JSON.parse(result.content[0].text as string);

    expect(symbols).toEqual([
      { name: 'semanticCodeSearchSchema', kind: 'variable', line: 10 },
      { name: 'semanticCodeSearch', kind: 'function', line: 20 },
    ]);
  });
});
