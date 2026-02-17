import { mapSymbolsByQuery } from '../../src/mcp_server/tools/map_symbols_by_query';
import { client } from '../../src/utils/elasticsearch';

jest.mock('../../src/utils/elasticsearch', () => ({
  client: {
    search: jest.fn(),
  },
  getLocationsIndexName: (index: string) => `${index}_locations`,
  getChunksById: jest.fn(),
  isIndexNotFoundError: jest.fn(),
  formatIndexNotFoundError: jest.fn(),
  elasticsearchConfig: {
    index: 'semantic-code-search',
  },
}));

describe('map_symbols_by_query', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should map symbols by file using locations + chunk join', async () => {
    (client.search as jest.Mock).mockResolvedValue({
      aggregations: {
        files: {
          buckets: [
            {
              key: 'src/example.ts',
              chunks: {
                buckets: [
                  {
                    key: 'c1',
                    sample: { hits: { hits: [{ _source: { startLine: 42 } }] } },
                  },
                ],
              },
            },
          ],
        },
      },
    });

    const { getChunksById } = jest.requireMock('../../src/utils/elasticsearch') as {
      getChunksById: jest.Mock;
    };
    getChunksById.mockResolvedValue({
      c1: {
        language: 'typescript',
        kind: 'function_declaration',
        symbols: [{ name: 'exampleFunction', kind: 'function', line: 42 }],
        imports: [{ path: './utils', type: 'module', symbols: ['helper'] }],
        exports: [{ name: 'myFunction', type: 'named' }],
      },
    });

    const result = await mapSymbolsByQuery({ kql: 'filePath: "src/example.ts"', size: 1000 });
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('Expected text content');
    const parsed = JSON.parse(first.text);

    expect(parsed['src/example.ts']).toBeDefined();
    expect(parsed['src/example.ts'].symbols.function[0]).toEqual({ name: 'exampleFunction', line: 42 });
    expect(parsed['src/example.ts'].imports.module[0]).toEqual({ path: './utils', symbols: ['helper'] });
    expect(parsed['src/example.ts'].exports.named[0]).toEqual({ name: 'myFunction' });
  });

  it('should remove trailing slashes from directory', async () => {
    (client.search as jest.Mock).mockResolvedValue({ aggregations: { files: { buckets: [] } } });
    const { getChunksById } = jest.requireMock('../../src/utils/elasticsearch') as { getChunksById: jest.Mock };
    getChunksById.mockResolvedValue({});

    await mapSymbolsByQuery({
      directory: 'src/utils/',
      size: 1000,
    });

    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'semantic-code-search_locations',
      })
    );
  });

  it('should throw error when both directory and kql provided', async () => {
    await expect(
      mapSymbolsByQuery({
        directory: 'src',
        kql: 'language: typescript',
        size: 1000,
      })
    ).rejects.toThrow('Cannot use both');
  });

  it('should throw error when neither directory nor kql provided', async () => {
    await expect(mapSymbolsByQuery({ size: 1000 })).rejects.toThrow('Must provide either');
  });
});
