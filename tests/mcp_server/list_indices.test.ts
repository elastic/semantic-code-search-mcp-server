import { listIndices } from '../../src/mcp_server/tools/list_indices';
import { client } from '../../src/utils/elasticsearch';
import { TextContent } from '@modelcontextprotocol/sdk/types';

jest.mock('../../src/utils/elasticsearch', () => ({
  client: {
    indices: {
      getAlias: jest.fn(),
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

const mockClient = client as jest.Mocked<typeof client>;

describe('listIndices', () => {
  beforeEach(() => {
    (mockClient.indices.getAlias as jest.Mock).mockClear();
    (mockClient.search as jest.Mock).mockClear();
  });

  it('should mark default when ELASTICSEARCH_INDEX matches the index name', async () => {
    (elasticsearchConfig.index as any) = 'kibana-code-search-2.0';
    (mockClient.indices.getAlias as jest.Mock).mockResolvedValue({
      'kibana-code-search-2.0': { aliases: { 'kibana-repo': {} } },
      'grafana-code-search': { aliases: { 'grafana-repo': {} } },
    });
    (mockClient.search as jest.Mock).mockResolvedValue({
      aggregations: {
        filesIndexed: { value: 100 },
        NumberOfSymbols: { total: { value: 200 } },
        Languages: { buckets: [] },
        Types: { buckets: [] },
      },
    });

    const result = await listIndices();
    const output = (result.content[0] as TextContent).text;

    expect(output).toContain('Index: kibana-repo (Default)');
    expect(output).not.toContain('Index: grafana-repo (Default)');
  });

  it('should mark default when ELASTICSEARCH_INDEX matches the alias name', async () => {
    (elasticsearchConfig.index as any) = 'grafana-repo';
    (mockClient.indices.getAlias as jest.Mock).mockResolvedValue({
      'kibana-code-search-2.0': { aliases: { 'kibana-repo': {} } },
      'grafana-code-search': { aliases: { 'grafana-repo': {} } },
    });
    (mockClient.search as jest.Mock).mockResolvedValue({
      aggregations: {
        filesIndexed: { value: 100 },
        NumberOfSymbols: { total: { value: 200 } },
        Languages: { buckets: [] },
        Types: { buckets: [] },
      },
    });

    const result = await listIndices();
    const output = (result.content[0] as TextContent).text;

    expect(output).not.toContain('Index: kibana-repo (Default)');
    expect(output).toContain('Index: grafana-repo (Default)');
  });
});
