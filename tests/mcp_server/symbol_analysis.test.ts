import { symbolAnalysis } from '../../src/mcp_server/tools/symbol_analysis';
import { client } from '../../src/utils/elasticsearch';

jest.mock('../../src/config', () => ({
  elasticsearchConfig: {
    index: 'semantic-code-search',
  },
  oidcConfig: {
    enabled: false,
    requiredClaims: ['sub'],
  },
}));

jest.mock('../../src/utils/elasticsearch', () => ({
  client: {
    search: jest.fn(),
    mget: jest.fn(),
    indices: { exists: jest.fn() },
  },
  elasticsearchConfig: {
    index: 'semantic-code-search',
  },
  getLocationsIndexName: (index: string) => `${index}_locations`,
  getChunksById: jest.fn(),
  isIndexNotFoundError: jest.fn(),
  formatIndexNotFoundError: jest.fn(),
}));

describe('symbol_analysis', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should construct the correct Elasticsearch query and format the report', async () => {
    (client.search as jest.Mock)
      // chunk search
      .mockResolvedValueOnce({
        hits: {
          hits: [{ _id: 'c1' }, { _id: 'c2' }, { _id: 'c3' }],
        },
      })
      // locations aggregation
      .mockResolvedValueOnce({
        aggregations: {
          files: {
            buckets: [
              {
                key: 'src/index.ts',
                chunks: {
                  buckets: [
                    { key: 'c1', startLine: { hits: { hits: [{ _source: { startLine: 10 } }] } } },
                    { key: 'c2', startLine: { hits: { hits: [{ _source: { startLine: 1 } }] } } },
                  ],
                },
              },
              {
                key: 'README.md',
                chunks: {
                  buckets: [{ key: 'c3', startLine: { hits: { hits: [{ _source: { startLine: 1 } }] } } }],
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
      c1: { language: 'typescript', kind: 'function_declaration' },
      c2: { language: 'typescript', kind: 'import_statement' },
      c3: { language: 'markdown', kind: 'comment' },
    });

    const result = await symbolAnalysis({ symbolName: 'mySymbol' });
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('Expected text content');
    const report = JSON.parse(first.text);

    expect(client.search).toHaveBeenCalledTimes(2);
    expect((client.search as jest.Mock).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        index: 'semantic-code-search',
        size: 5000,
        _source: false,
      })
    );
    expect((client.search as jest.Mock).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        index: 'semantic-code-search_locations',
        size: 0,
      })
    );

    expect(report.primaryDefinitions).toHaveLength(1);
    expect(report.primaryDefinitions[0].filePath).toBe('src/index.ts');
    expect(report.documentation).toHaveLength(1);
    expect(report.documentation[0].filePath).toBe('README.md');
  });

  it('should use the provided index when searching', async () => {
    (client.search as jest.Mock).mockResolvedValueOnce({ hits: { hits: [] } });

    await symbolAnalysis({ symbolName: 'mySymbol', index: 'my-test-index' });

    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'my-test-index',
      })
    );
  });
});
