import { TextContent } from '@modelcontextprotocol/sdk/types';
import type { IndicesGetAliasResponse, IndicesGetResponse, SearchResponse } from '@elastic/elasticsearch/lib/api/types';

import { listIndices } from '../../src/mcp_server/tools/list_indices';
import { client } from '../../src/utils/elasticsearch';

jest.mock('../../src/utils/elasticsearch', () => ({
  client: {
    indices: {
      getAlias: jest.fn(),
      get: jest.fn(),
      exists: jest.fn(),
    },
    search: jest.fn(),
  },
}));

jest.mock('../../src/config', () => ({
  elasticsearchConfig: {
    index: 'kibana-code-search-2.0', // Default index name for tests
  },
}));
import { elasticsearchConfig } from '../../src/config';

const mockClient = jest.mocked(client);

// Mock console.warn to suppress output and allow verification
const originalWarn = console.warn;
const mockConsoleWarn = jest.fn();

// Helper to create a minimal SearchResponse with aggregations
function createSearchResponse(
  aggregations: SearchResponse<unknown, Record<string, unknown>>['aggregations']
): SearchResponse<unknown, Record<string, unknown>> {
  return {
    took: 0,
    timed_out: false,
    _shards: {
      total: 1,
      successful: 1,
      skipped: 0,
      failed: 0,
    },
    hits: {
      total: {
        value: 0,
        relation: 'eq' as const,
      },
      max_score: null,
      hits: [],
    },
    aggregations,
  };
}

describe('listIndices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    console.warn = mockConsoleWarn;
  });

  afterAll(() => {
    console.warn = originalWarn;
  });

  it('should mark default when ELASTICSEARCH_INDEX matches the index name', async () => {
    (elasticsearchConfig as { index: string }).index = 'kibana-code-search-2.0';
    const getAliasResponse: IndicesGetAliasResponse = {
      'kibana-code-search-2.0': { aliases: { 'kibana-repo': {} } },
      'grafana-code-search': { aliases: { 'grafana-repo': {} } },
    };
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue(getAliasResponse);
    jest.mocked(mockClient.indices.get).mockResolvedValue({});
    jest.mocked(mockClient.search).mockResolvedValue(
      createSearchResponse({
        filesIndexed: { value: 100 },
        NumberOfSymbols: { total: { value: 200 } },
        Languages: { buckets: [] },
        Types: { buckets: [] },
      })
    );

    const result = await listIndices();
    const output = result.content[0].text;

    expect(output).toContain('Index: kibana-code-search-2.0 (Default)');
    expect(output).not.toContain('Index: grafana-code-search (Default)');
    // Should not log warnings during normal operation
    expect(mockConsoleWarn).not.toHaveBeenCalled();
  });

  it('should mark default when ELASTICSEARCH_INDEX matches the alias name', async () => {
    elasticsearchConfig.index = 'grafana-repo';
    const getAliasResponse: IndicesGetAliasResponse = {
      'kibana-code-search-2.0': { aliases: { 'kibana-repo': {} } },
      'grafana-code-search': { aliases: { 'grafana-repo': {} } },
    };
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue(getAliasResponse);
    jest.mocked(mockClient.indices.get).mockResolvedValue({});
    jest.mocked(mockClient.search).mockResolvedValue(
      createSearchResponse({
        filesIndexed: { value: 100 },
        NumberOfSymbols: { total: { value: 200 } },
        Languages: { buckets: [] },
        Types: { buckets: [] },
      })
    );

    const result = await listIndices();
    const output = result.content[0].text;

    expect(output).not.toContain('Index: kibana-code-search-2.0 (Default)');
    expect(output).toContain('Index: grafana-code-search (Default)');
  });

  it('should fallback to _settings indices when no aliases are found', async () => {
    elasticsearchConfig.index = 'my-repo';
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue({});
    const getResponse: IndicesGetResponse = {
      'my-repo_settings': {},
      'other-repo_settings': {},
    };
    jest.mocked(mockClient.indices.get).mockResolvedValue(getResponse);
    jest.mocked(mockClient.indices.exists).mockResolvedValue(true);
    jest.mocked(mockClient.search).mockResolvedValue(
      createSearchResponse({
        filesIndexed: { value: 50 },
        NumberOfSymbols: { total: { value: 100 } },
        Languages: { buckets: [] },
        Types: { buckets: [] },
      })
    );

    const result = await listIndices();
    const output = result.content[0].text;

    expect(output).toContain('Index: my-repo (Default)');
    expect(output).toContain('Index: other-repo');
  });

  it('should prefer aliases over _settings indices when both exist', async () => {
    elasticsearchConfig.index = 'my-repo-index';
    // Alias 'my-repo' points to 'my-repo-index'
    const getAliasResponse: IndicesGetAliasResponse = {
      'my-repo-index': { aliases: { 'my-repo': {} } },
    };
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue(getAliasResponse);
    // _settings also exists for 'my-repo-index' (same underlying index)
    const getResponse: IndicesGetResponse = {
      'my-repo-index_settings': {},
    };
    jest.mocked(mockClient.indices.get).mockResolvedValue(getResponse);
    jest.mocked(mockClient.indices.exists).mockResolvedValue(true);
    jest.mocked(mockClient.search).mockResolvedValue(
      createSearchResponse({
        filesIndexed: { value: 50 },
        NumberOfSymbols: { total: { value: 100 } },
        Languages: { buckets: [] },
        Types: { buckets: [] },
      })
    );

    const result = await listIndices();
    const output = (result.content[0] as TextContent).text;

    // Should deduplicate and show only once, using index name from alias (preferred)
    const matches = output.match(/Index: my-repo-index/g);
    expect(matches).toHaveLength(1);
    expect(output).toContain('Index: my-repo-index');
  });

  it('should return appropriate message when no indices are found', async () => {
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue({});
    jest.mocked(mockClient.indices.get).mockResolvedValue({});

    const result = await listIndices();
    const output = result.content[0].text;

    expect(output).toContain('No indices found');
    expect(output).toContain('aliases ending with "-repo"');
    expect(output).toContain('indices ending with "_settings"');
  });

  it('should handle languages and types buckets correctly', async () => {
    const getAliasResponse: IndicesGetAliasResponse = {
      'test-index': { aliases: { 'test-repo': {} } },
    };
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue(getAliasResponse);
    jest.mocked(mockClient.indices.get).mockResolvedValue({});
    jest.mocked(mockClient.search).mockResolvedValue(
      createSearchResponse({
        filesIndexed: { value: 150 },
        NumberOfSymbols: { total: { value: 300 } },
        Languages: {
          buckets: [
            { key: 'typescript', numberOfFiles: { value: 100 } },
            { key: 'javascript', numberOfFiles: { value: 50 } },
          ],
        },
        Types: {
          buckets: [
            { key: 'function_declaration', numberOfFiles: { value: 80 } },
            { key: 'class_declaration', numberOfFiles: { value: 20 } },
          ],
        },
      })
    );

    const result = await listIndices();
    const output = result.content[0].text;

    expect(output).toContain('Index: test-index');
    expect(output).toContain('Files: 150 total');
    expect(output).toContain('Symbols: 300 total');
    expect(output).toContain('typescript (100 files)');
    expect(output).toContain('javascript (50 files)');
    expect(output).toContain('function_declaration (80 files)');
    expect(output).toContain('class_declaration (20 files)');
  });

  it('should handle missing aggregations gracefully', async () => {
    const getAliasResponse: IndicesGetAliasResponse = {
      'test-index': { aliases: { 'test-repo': {} } },
    };
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue(getAliasResponse);
    jest.mocked(mockClient.indices.get).mockResolvedValue({});
    jest.mocked(mockClient.search).mockResolvedValue(createSearchResponse(undefined));

    const result = await listIndices();
    const output = result.content[0].text;

    // Should not include test-index since aggregations are missing
    expect(output).not.toContain('Index: test-index');
  });

  it('should handle search errors gracefully', async () => {
    const getAliasResponse: IndicesGetAliasResponse = {
      'test-index': { aliases: { 'test-repo': {} } },
    };
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue(getAliasResponse);
    jest.mocked(mockClient.indices.get).mockResolvedValue({});
    jest.mocked(mockClient.search).mockRejectedValue(new Error('Search failed'));

    const result = await listIndices();
    const output = result.content[0].text;

    // Should not include test-index since search failed
    expect(output).not.toContain('Index: test-index');
  });

  it('should handle alias query errors and fallback to _settings', async () => {
    (elasticsearchConfig as { index: string }).index = 'my-repo';
    const aliasError = new Error('Alias query failed');
    jest.mocked(mockClient.indices.getAlias).mockRejectedValue(aliasError);
    const getResponse: IndicesGetResponse = {
      'my-repo_settings': {},
    };
    jest.mocked(mockClient.indices.get).mockResolvedValue(getResponse);
    jest.mocked(mockClient.indices.exists).mockResolvedValue(true);
    jest.mocked(mockClient.search).mockResolvedValue(
      createSearchResponse({
        filesIndexed: { value: 50 },
        NumberOfSymbols: { total: { value: 100 } },
        Languages: { buckets: [] },
        Types: { buckets: [] },
      })
    );

    const result = await listIndices();
    const output = result.content[0].text;

    // Should still find indices via _settings fallback
    expect(output).toContain('Index: my-repo (Default)');
    // Should log warning about alias query failure
    expect(mockConsoleWarn).toHaveBeenCalledWith('Failed to query aliases:', aliasError);
    // Verify fallback was attempted
    expect(mockClient.indices.get).toHaveBeenCalledWith({ index: '*_settings' });
  });

  it('should handle _settings query errors gracefully', async () => {
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue({});
    const settingsError = new Error('Settings query failed');
    jest.mocked(mockClient.indices.get).mockRejectedValue(settingsError);

    const result = await listIndices();
    const output = result.content[0].text;

    expect(output).toContain('No indices found');
    // Should log warning about settings query failure
    expect(mockConsoleWarn).toHaveBeenCalledWith('Failed to discover indices from _settings pattern:', settingsError);
  });

  it('should skip _settings indices when base index does not exist', async () => {
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue({});
    const getResponse: IndicesGetResponse = {
      orphan_settings: {}, // Base index 'orphan' doesn't exist
    };
    jest.mocked(mockClient.indices.get).mockResolvedValue(getResponse);
    jest.mocked(mockClient.indices.exists).mockResolvedValue(false);

    const result = await listIndices();
    const output = result.content[0].text;

    expect(output).not.toContain('Index: orphan');
    expect(output).toContain('No indices found');
  });

  it('should handle exists check errors gracefully', async () => {
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue({});
    const getResponse: IndicesGetResponse = {
      'test-repo_settings': {},
    };
    jest.mocked(mockClient.indices.get).mockResolvedValue(getResponse);
    jest.mocked(mockClient.indices.exists).mockRejectedValue(new Error('Exists check failed'));

    const result = await listIndices();
    const output = result.content[0].text;

    // Should skip indices where exists check fails
    expect(output).not.toContain('Index: test-repo');
    // Exists check errors are caught silently (no warning)
    expect(mockConsoleWarn).not.toHaveBeenCalled();
  });

  it('should deduplicate indices found via both methods', async () => {
    elasticsearchConfig.index = 'my-repo-index';
    // Alias 'my-repo' points to 'my-repo-index'
    const getAliasResponse: IndicesGetAliasResponse = {
      'my-repo-index': { aliases: { 'my-repo': {} } },
    };
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue(getAliasResponse);
    // _settings also exists for 'my-repo-index' (same underlying index)
    const getResponse: IndicesGetResponse = {
      'my-repo-index_settings': {},
    };
    jest.mocked(mockClient.indices.get).mockResolvedValue(getResponse);
    jest.mocked(mockClient.indices.exists).mockResolvedValue(true);
    jest.mocked(mockClient.search).mockResolvedValue(
      createSearchResponse({
        filesIndexed: { value: 50 },
        NumberOfSymbols: { total: { value: 100 } },
        Languages: { buckets: [] },
        Types: { buckets: [] },
      })
    );

    const result = await listIndices();
    const output = (result.content[0] as TextContent).text;

    // Should only appear once, using index name
    const matches = output.match(/Index: my-repo-index/g);
    expect(matches).toHaveLength(1);
    expect(output).toContain('Index: my-repo-index');
  });

  it('should sort indices alphabetically', async () => {
    const getAliasResponse: IndicesGetAliasResponse = {
      'z-index': { aliases: { 'z-repo': {} } },
      'a-index': { aliases: { 'a-repo': {} } },
    };
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue(getAliasResponse);
    jest.mocked(mockClient.indices.get).mockResolvedValue({});
    jest.mocked(mockClient.search).mockResolvedValue(
      createSearchResponse({
        filesIndexed: { value: 50 },
        NumberOfSymbols: { total: { value: 100 } },
        Languages: { buckets: [] },
        Types: { buckets: [] },
      })
    );

    const result = await listIndices();
    const output = (result.content[0] as TextContent).text;

    const aIndexPos = output.indexOf('Index: a-index');
    const zIndexPos = output.indexOf('Index: z-index');
    expect(aIndexPos).toBeLessThan(zIndexPos);
  });

  it('should format large numbers correctly', async () => {
    const getAliasResponse: IndicesGetAliasResponse = {
      'large-index': { aliases: { 'large-repo': {} } },
    };
    // Note: Will show 'large-index' not 'large-repo'
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue(getAliasResponse);
    jest.mocked(mockClient.indices.get).mockResolvedValue({});
    jest.mocked(mockClient.search).mockResolvedValue(
      createSearchResponse({
        filesIndexed: { value: 1500000 },
        NumberOfSymbols: { total: { value: 2500 } },
        Languages: {
          buckets: [{ key: 'typescript', numberOfFiles: { value: 1500000 } }],
        },
        Types: { buckets: [] },
      })
    );

    const result = await listIndices();
    const output = result.content[0].text;

    expect(output).toContain('Index: large-index');
    expect(output).toContain('Files: 1,500,000 total');
    expect(output).toContain('typescript (1.5M files)');
  });

  it('should handle null aggregation values gracefully', async () => {
    const getAliasResponse: IndicesGetAliasResponse = {
      'test-index': { aliases: { 'test-repo': {} } },
    };
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue(getAliasResponse);
    jest.mocked(mockClient.indices.get).mockResolvedValue({});
    jest.mocked(mockClient.search).mockResolvedValue(
      createSearchResponse({
        filesIndexed: { value: null },
        NumberOfSymbols: { total: { value: null } },
        Languages: { buckets: null },
        Types: { buckets: undefined },
      })
    );

    const result = await listIndices();
    const output = result.content[0].text;

    // Should still include the index with default values
    expect(output).toContain('Index: test-index');
    expect(output).toContain('Files: 0 total');
    expect(output).toContain('Symbols: 0 total');
    expect(output).toContain('Languages: none');
    expect(output).toContain('Content: none');
  });

  it('should handle empty buckets arrays', async () => {
    const getAliasResponse: IndicesGetAliasResponse = {
      'test-index': { aliases: { 'test-repo': {} } },
    };
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue(getAliasResponse);
    jest.mocked(mockClient.indices.get).mockResolvedValue({});
    jest.mocked(mockClient.search).mockResolvedValue(
      createSearchResponse({
        filesIndexed: { value: 100 },
        NumberOfSymbols: { total: { value: 200 } },
        Languages: { buckets: [] },
        Types: { buckets: [] },
      })
    );

    const result = await listIndices();
    const output = result.content[0].text;

    expect(output).toContain('Index: test-index');
    expect(output).toContain('Languages: none');
    expect(output).toContain('Content: none');
  });

  it('should handle missing numberOfFiles in bucket', async () => {
    const getAliasResponse: IndicesGetAliasResponse = {
      'test-index': { aliases: { 'test-repo': {} } },
    };
    jest.mocked(mockClient.indices.getAlias).mockResolvedValue(getAliasResponse);
    jest.mocked(mockClient.indices.get).mockResolvedValue({});
    jest.mocked(mockClient.search).mockResolvedValue(
      createSearchResponse({
        filesIndexed: { value: 100 },
        NumberOfSymbols: { total: { value: 200 } },
        Languages: {
          buckets: [
            { key: 'typescript', numberOfFiles: { value: null } },
            { key: 'javascript' }, // missing numberOfFiles
          ],
        },
        Types: { buckets: [] },
      })
    );

    const result = await listIndices();
    const output = result.content[0].text;

    expect(output).toContain('Index: test-index');
    expect(output).toContain('typescript (0 files)');
    expect(output).toContain('javascript (0 files)');
  });
});
