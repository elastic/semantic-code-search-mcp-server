import { listSymbolsByQuery } from '../../src/mcp_server/tools/list_symbols_by_query';
import { aggregateBySymbolsAndImports } from '../../src/utils/elasticsearch';

jest.mock('../../src/utils/elasticsearch', () => ({
  ...jest.requireActual('../../src/utils/elasticsearch'),
  aggregateBySymbolsAndImports: jest.fn(),
}));

describe('list_symbols_by_query', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call aggregateBySymbolsAndImports with the correct DSL query and return the result', async () => {
    const mockAggregations = {
      'src/example.ts': {
        symbols: {
          function: [
            {
              name: 'exampleFunction',
              line: 42,
            },
          ],
        },
        imports: {
          module: [
            {
              path: './utils',
              symbols: ['helper', 'utils'],
            },
          ],
        },
      },
    };
    (aggregateBySymbolsAndImports as jest.Mock).mockResolvedValue(mockAggregations);

    const result = await listSymbolsByQuery({ kql: 'language: typescript' });

    expect(aggregateBySymbolsAndImports).toHaveBeenCalledWith({
      bool: {
        minimum_should_match: 1,
        should: [
          {
            match: {
              language: 'typescript',
            },
          },
        ],
      },
    });

    expect(JSON.parse(result.content[0].text as string)).toEqual(mockAggregations);
  });
});