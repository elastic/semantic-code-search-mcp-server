import { mapSymbolsByQuery } from '../../src/mcp_server/tools/map_symbols_by_query';
import { aggregateBySymbolsAndImports } from '../../src/utils/elasticsearch';

jest.mock('../../src/utils/elasticsearch', () => ({
  aggregateBySymbolsAndImports: jest.fn(),
  elasticsearchConfig: {
    index: 'semantic-code-search',
  },
}));

describe('map_symbols_by_query', () => {
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

    const result = await mapSymbolsByQuery({ kql: 'language: typescript', size: 1000 });

    expect(aggregateBySymbolsAndImports).toHaveBeenCalledWith(
      {
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
      },
      undefined,
      1000
    );

    expect(JSON.parse(result.content[0].text as string)).toEqual(mockAggregations);
  });

  it('should call aggregateBySymbolsAndImports with the correct DSL query and index', async () => {
    const mockAggregations = {};
    (aggregateBySymbolsAndImports as jest.Mock).mockResolvedValue(mockAggregations);

    const result = await mapSymbolsByQuery({
      kql: 'language: typescript',
      index: 'my-index',
      size: 1000,
    });

    expect(aggregateBySymbolsAndImports).toHaveBeenCalledWith(
      {
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
      },
      'my-index',
      1000
    );

    expect(JSON.parse(result.content[0].text as string)).toEqual(mockAggregations);
  });
});

describe('map_symbols_by_query with directory parameter', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should convert directory to KQL correctly', async () => {
    const mockAggregations = {
      'src/platform/packages/kbn-esql/parser.ts': {
        symbols: {
          'function_declaration': [
            { name: 'parseQuery', line: 42 }
          ]
        },
        imports: {}
      }
    };
    (aggregateBySymbolsAndImports as jest.Mock).mockResolvedValue(mockAggregations);

    const result = await mapSymbolsByQuery({ 
      directory: 'src/platform/packages/kbn-esql',
      size: 1000 
    });

    // Verify the aggregateBySymbolsAndImports was called with correct DSL
    expect(aggregateBySymbolsAndImports).toHaveBeenCalledWith(
      expect.objectContaining({
        bool: expect.objectContaining({
          should: expect.arrayContaining([
            expect.objectContaining({
              query_string: expect.objectContaining({
                fields: ['filePath'],
                query: 'src\\/platform\\/packages\\/kbn\\-esql\\/*'
              })
            })
          ])
        })
      }),
      undefined,
      1000
    );

    expect(JSON.parse(result.content[0].text as string)).toEqual(mockAggregations);
  });
  
  it('should remove trailing slashes from directory', async () => {
    (aggregateBySymbolsAndImports as jest.Mock).mockResolvedValue({});
    
    await mapSymbolsByQuery({ 
      directory: 'src/utils/',
      size: 1000 
    });

    expect(aggregateBySymbolsAndImports).toHaveBeenCalledWith(
      expect.objectContaining({
        bool: expect.objectContaining({
          should: expect.arrayContaining([
            expect.objectContaining({
              query_string: expect.objectContaining({
                fields: ['filePath'],
                query: 'src\\/utils\\/*'
              })
            })
          ])
        })
      }),
      undefined,
      1000
    );
  });
  
  it('should throw error when both directory and kql provided', async () => {
    await expect(
      mapSymbolsByQuery({ 
        directory: 'src', 
        kql: 'language: typescript',
        size: 1000 
      })
    ).rejects.toThrow('Cannot use both');
  });
  
  it('should throw error when neither directory nor kql provided', async () => {
    await expect(
      mapSymbolsByQuery({ size: 1000 })
    ).rejects.toThrow('Must provide either');
  });

  it('should work with custom index', async () => {
    (aggregateBySymbolsAndImports as jest.Mock).mockResolvedValue({});
    
    await mapSymbolsByQuery({ 
      directory: 'src/utils',
      index: 'custom-index',
      size: 1000 
    });

    expect(aggregateBySymbolsAndImports).toHaveBeenCalledWith(
      expect.anything(),
      'custom-index',
      1000
    );
  });
});