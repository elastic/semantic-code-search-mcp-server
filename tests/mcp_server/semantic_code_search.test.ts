import { semanticCodeSearch } from '../../src/mcp_server/tools/semantic_code_search';
import { client, isIndexNotFoundError, formatIndexNotFoundError } from '../../src/utils/elasticsearch';

jest.mock('../../src/utils/elasticsearch', () => ({
  client: {
    search: jest.fn(),
    indices: {
      getAlias: jest.fn(),
    },
  },
  elasticsearchConfig: {
    index: 'test-index',
  },
  isIndexNotFoundError: jest.fn(),
  formatIndexNotFoundError: jest.fn(),
}));

describe('semantic_code_search', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should throw an error if no query or kql is provided', async () => {
    await expect(semanticCodeSearch({ page: 1, size: 10 })).rejects.toThrow(
      'Either a query for semantic search or a kql filter is required.'
    );
  });

  it('should construct the correct Elasticsearch query with both query and kql', async () => {
    (client.search as jest.Mock).mockResolvedValue({
      hits: {
        hits: [],
      },
    });

    await semanticCodeSearch({
      query: 'test query',
      kql: 'language: typescript',
      page: 2,
      size: 50,
    });

    expect(client.search).toHaveBeenCalledWith({
      index: 'test-index',
      query: {
        bool: {
          must: [
            {
              semantic: {
                field: 'semantic_text',
                query: 'test query',
              },
            },
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
          ],
          should: [
            {
              term: {
                language: {
                  value: 'markdown',
                  boost: 2,
                },
              },
            },
          ],
        },
      },
      from: 50,
      size: 50,
      _source_excludes: ['code_vector', 'semantic_text'],
    });
  });

  it('should return a simplified response', async () => {
    const mockHits = [
      {
        _score: 1.23,
        _source: {
          type: 'code',
          language: 'typescript',
          kind: 'function_declaration',
          filePath: 'src/index.ts',
          content: 'f()',
          startLine: 1,
          endLine: 1,
        },
      },
    ];

    (client.search as jest.Mock).mockResolvedValue({
      hits: {
        hits: mockHits,
      },
    });

    const result = await semanticCodeSearch({
      query: 'test query',
      page: 1,
      size: 10,
    });

    const expectedContent = [
      {
        score: 1.23,
        type: 'code',
        language: 'typescript',
        kind: 'function_declaration',
        filePath: 'src/index.ts',
        content: 'f()',
      },
    ];

    expect(JSON.parse(result.content[0].text as string)).toEqual(expectedContent);
  });

  it('should use the provided index when searching', async () => {
    (client.search as jest.Mock).mockResolvedValue({
      hits: {
        hits: [],
      },
    });

    await semanticCodeSearch({
      query: 'test query',
      index: 'my-test-index',
      page: 1,
      size: 10,
    });

    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'my-test-index',
      })
    );
  });

  it('should return helpful error message when index is not found', async () => {
    const indexNotFoundError = {
      meta: {
        body: {
          error: {
            type: 'index_not_found_exception',
          },
        },
      },
    };

    (client.search as jest.Mock).mockRejectedValue(indexNotFoundError);
    (isIndexNotFoundError as jest.Mock).mockReturnValue(true);
    (formatIndexNotFoundError as jest.Mock).mockResolvedValue(
      "The index 'nonexistent-index' was not found.\n\nAvailable indices:\n- test-index (100 files)"
    );

    const result = await semanticCodeSearch({
      query: 'test query',
      index: 'nonexistent-index',
      page: 1,
      size: 10,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("The index 'nonexistent-index' was not found.");
    expect(result.content[0].text).toContain('Available indices:');
  });

  it('should rethrow non-index-not-found errors', async () => {
    const otherError = new Error('Connection failed');

    (client.search as jest.Mock).mockRejectedValue(otherError);
    (isIndexNotFoundError as jest.Mock).mockReturnValue(false);

    await expect(
      semanticCodeSearch({
        query: 'test query',
        page: 1,
        size: 10,
      })
    ).rejects.toThrow('Connection failed');
  });
});