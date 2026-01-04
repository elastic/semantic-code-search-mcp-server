import { discoverDirectories } from '../../src/mcp_server/tools/discover_directories';
import { client } from '../../src/utils/elasticsearch';

jest.mock('../../src/utils/elasticsearch', () => ({
  client: {
    search: jest.fn(),
    mget: jest.fn(),
  },
  elasticsearchConfig: {
    index: 'semantic-code-search',
  },
  isIndexNotFoundError: jest.fn(),
  formatIndexNotFoundError: jest.fn(),
}));

const mockClient = client as jest.Mocked<typeof client>;

describe('discover_directories', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should construct the correct Elasticsearch query with semantic and KQL filters', async () => {
    mockClient.search
      // chunk search
      .mockResolvedValueOnce({ hits: { hits: [{ _id: 'c1' }] } } as never)
      // locations aggregation
      .mockResolvedValueOnce({
        aggregations: {
          directories: {
            buckets: [
              {
                key: 'src/utils',
                doc_count: 15,
                file_count: { value: 10 },
                top_chunks: { buckets: [{ key: 'c1', doc_count: 3 }] },
              },
            ],
          },
        },
      } as never);
    (mockClient.mget as jest.Mock).mockResolvedValue({
      docs: [
        { _id: 'c1', found: true, _source: { language: 'typescript', kind: 'function_declaration', symbols: [] } },
      ],
    });

    const result = await discoverDirectories({
      query: 'authentication utilities',
      kql: 'language: typescript',
      minFiles: 5,
      maxResults: 10,
    } as Parameters<typeof discoverDirectories>[0]);

    expect(mockClient.search).toHaveBeenCalledTimes(2);
    expect((mockClient.search as jest.Mock).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        index: 'semantic-code-search',
        size: 5000,
        _source: false,
      })
    );
    expect((mockClient.search as jest.Mock).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        index: 'semantic-code-search_locations',
        size: 0,
      })
    );

    const output = result.content[0].text as string;
    expect(output).toContain('Found 1 significant directories');
    expect(output).toContain('src/utils');
    expect(output).toContain('Files**: 10');
    expect(output).toContain('Score**: 15.000');
  });

  it('should handle query without KQL', async () => {
    mockClient.search.mockResolvedValueOnce({ hits: { hits: [{ _id: 'c1' }] } } as never).mockResolvedValueOnce({
      aggregations: { directories: { buckets: [] } },
    } as never);
    (mockClient.mget as jest.Mock).mockResolvedValue({ docs: [] });

    await discoverDirectories({
      query: 'test',
      minFiles: 3,
    } as Parameters<typeof discoverDirectories>[0]);

    expect(mockClient.search).toHaveBeenCalledTimes(2);
  });

  it('should handle empty results', async () => {
    mockClient.search.mockResolvedValueOnce({ hits: { hits: [{ _id: 'c1' }] } } as never).mockResolvedValueOnce({
      aggregations: { directories: { buckets: [] } },
    } as never);
    (mockClient.mget as jest.Mock).mockResolvedValue({ docs: [] });

    const result = await discoverDirectories({
      query: 'nonexistent',
    } as Parameters<typeof discoverDirectories>[0]);

    const output = result.content[0].text as string;
    expect(output).toBe('No significant directories found matching your criteria.');
  });

  it('should use custom index when provided', async () => {
    mockClient.search.mockResolvedValueOnce({ hits: { hits: [] } } as never);

    await discoverDirectories({
      query: 'test',
      index: 'custom-index',
    } as Parameters<typeof discoverDirectories>[0]);

    expect(mockClient.search).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'custom-index',
      })
    );
  });
});
