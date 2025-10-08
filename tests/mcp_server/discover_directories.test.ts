import { discoverDirectories } from '../../src/mcp_server/tools/discover_directories';
import { client } from '../../src/utils/elasticsearch';

jest.mock('../../src/utils/elasticsearch', () => ({
  client: {
    search: jest.fn(),
  },
  elasticsearchConfig: {
    index: 'semantic-code-search',
  },
}));

const mockClient = client as jest.Mocked<typeof client>;

interface MockSearchResponse {
  aggregations: {
    directories: {
      buckets: Array<{
        key: string;
        doc_count: number;
        file_count: { value: number };
        symbol_count: { count: { value: number } };
        languages: { buckets: Array<{ key: string; doc_count: number }> };
        top_kinds: { buckets: Array<{ key: string; doc_count: number }> };
        sample_files: { buckets: Array<{ key: string }> };
      }>;
    };
  };
}

describe('discover_directories', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should construct the correct Elasticsearch query with semantic and KQL filters', async () => {
    const mockResponse: MockSearchResponse = {
      aggregations: {
        directories: {
          buckets: [
            {
              key: 'src/utils',
              doc_count: 15,
              file_count: { value: 10 },
              symbol_count: { count: { value: 150 } },
              languages: { buckets: [{ key: 'typescript', doc_count: 10 }] },
              top_kinds: { buckets: [{ key: 'function_declaration', doc_count: 50 }] },
              sample_files: { buckets: [{ key: 'src/utils/README.md' }] }
            }
          ]
        }
      }
    };
    mockClient.search.mockResolvedValue(mockResponse as never);

    const result = await discoverDirectories({
      query: 'authentication utilities',
      kql: 'language: typescript',
      minFiles: 5,
      maxResults: 10
    } as Parameters<typeof discoverDirectories>[0]);

    expect(mockClient.search).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'semantic-code-search',
        query: {
          bool: {
            must: [
              {
                semantic: {
                  field: 'semantic_text',
                  query: 'authentication utilities'
                }
              },
              expect.any(Object)
            ]
          }
        },
        size: 0,
        aggs: expect.objectContaining({
          directories: expect.objectContaining({
            terms: expect.objectContaining({
              field: 'directory',
              size: 10,
              min_doc_count: 5
            })
          })
        })
      })
    );

    const output = result.content[0].text as string;
    expect(output).toContain('Found 1 significant directories');
    expect(output).toContain('src/utils');
    expect(output).toContain('Files**: 10');
    expect(output).toContain('Symbols**: 150');
    expect(output).toContain('README.md');
  });

  it('should handle query without KQL', async () => {
    const mockResponse: MockSearchResponse = {
      aggregations: {
        directories: {
          buckets: []
        }
      }
    };
    mockClient.search.mockResolvedValue(mockResponse as never);

    await discoverDirectories({
      query: 'test',
      minFiles: 3
    } as Parameters<typeof discoverDirectories>[0]);

    expect(mockClient.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          bool: {
            must: [
              {
                semantic: {
                  field: 'semantic_text',
                  query: 'test'
                }
              }
            ]
          }
        }
      })
    );
  });

  it('should handle empty results', async () => {
    const mockResponse: MockSearchResponse = {
      aggregations: {
        directories: {
          buckets: []
        }
      }
    };
    mockClient.search.mockResolvedValue(mockResponse as never);

    const result = await discoverDirectories({
      query: 'nonexistent',
    } as Parameters<typeof discoverDirectories>[0]);

    const output = result.content[0].text as string;
    expect(output).toBe('No significant directories found matching your criteria.');
  });

  it('should use custom index when provided', async () => {
    const mockResponse: MockSearchResponse = {
      aggregations: {
        directories: {
          buckets: []
        }
      }
    };
    mockClient.search.mockResolvedValue(mockResponse as never);

    await discoverDirectories({
      query: 'test',
      index: 'custom-index'
    } as Parameters<typeof discoverDirectories>[0]);

    expect(mockClient.search).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'custom-index'
      })
    );
  });
});
