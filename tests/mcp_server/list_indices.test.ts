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
  getLocationsIndexName: (index: string) => `${index}_locations`,
}));

jest.mock('../../src/config', () => ({
  elasticsearchConfig: {
    index: 'kibana', // Default alias name for tests
  },
}));
import { elasticsearchConfig } from '../../src/config';

const mockClient = client as jest.Mocked<typeof client>;

describe('listIndices', () => {
  beforeEach(() => {
    (mockClient.indices.getAlias as jest.Mock).mockClear();
    (mockClient.search as jest.Mock).mockClear();
  });

  it('should return a helpful message when no location aliases are found', async () => {
    (mockClient.indices.getAlias as jest.Mock).mockRejectedValue({ meta: { statusCode: 404 } });

    const result = await listIndices();
    const output = (result.content[0] as TextContent).text;

    expect(output).toContain('No semantic code search indices found.');
    expect(output).toContain('Expected to find aliases matching "*_locations"');
  });

  it('should mark default when ELASTICSEARCH_INDEX matches the index name', async () => {
    (elasticsearchConfig as { index: string }).index = 'kibana';
    (mockClient.indices.getAlias as jest.Mock).mockResolvedValue({
      'kibana-scsi-abc123_locations': { aliases: { kibana_locations: {} } },
      'grafana-scsi-def456_locations': { aliases: { grafana_locations: {} } },
    });
    (mockClient.search as jest.Mock).mockImplementation(({ index }: { index: string }) => {
      if (index.endsWith('_locations')) {
        return Promise.resolve({ aggregations: { filesIndexed: { value: 100 } } });
      }
      return Promise.resolve({
        aggregations: {
          NumberOfSymbols: { total: { value: 200 } },
          Languages: { buckets: [] },
          Types: { buckets: [] },
        },
      });
    });

    const result = await listIndices();
    const output = (result.content[0] as TextContent).text;

    expect(output).toContain('Index: kibana (Default)');
    expect(output).not.toContain('Index: grafana (Default)');
  });

  it('should mark default when ELASTICSEARCH_INDEX matches the alias name', async () => {
    (elasticsearchConfig as { index: string }).index = 'grafana';
    (mockClient.indices.getAlias as jest.Mock).mockResolvedValue({
      'kibana-scsi-abc123_locations': { aliases: { kibana_locations: {} } },
      'grafana-scsi-def456_locations': { aliases: { grafana_locations: {} } },
    });
    (mockClient.search as jest.Mock).mockImplementation(({ index }: { index: string }) => {
      if (index.endsWith('_locations')) {
        return Promise.resolve({ aggregations: { filesIndexed: { value: 100 } } });
      }
      return Promise.resolve({
        aggregations: {
          NumberOfSymbols: { total: { value: 200 } },
          Languages: { buckets: [] },
          Types: { buckets: [] },
        },
      });
    });

    const result = await listIndices();
    const output = (result.content[0] as TextContent).text;

    expect(output).not.toContain('Index: kibana (Default)');
    expect(output).toContain('Index: grafana (Default)');
  });
});
