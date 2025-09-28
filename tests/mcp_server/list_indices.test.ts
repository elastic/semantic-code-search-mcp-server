import { listIndices } from '../../src/mcp_server/tools/list_indices';
import { client } from '../../src/utils/elasticsearch';
import { TextContent } from '@modelcontextprotocol/sdk/types';

jest.mock('../../src/utils/elasticsearch');

const mockClient = client as jest.Mocked<typeof client>;
mockClient.indices = { getAlias: jest.fn() } as unknown;
mockClient.search = jest.fn();

describe('listIndices', () => {
  it('should return a formatted string of index statistics', async () => {
    (mockClient.indices.getAlias as jest.Mock).mockResolvedValue({
      'kibana-code-search-2.0': { aliases: { 'kibana-repo': {} } },
      'grafana-code-search': { aliases: { 'grafana-repo': {} } },
    });
    (mockClient.search as jest.Mock).mockResolvedValue({
      aggregations: {
        filesIndexed: { value: 73843 },
        NumberOfSymbols: { total: { value: 226763 } },
        Languages: {
          buckets: [
            { key: 'typescript', numberOfFiles: { value: 63452 } },
            { key: 'javascript', numberOfFiles: { value: 3486 } },
          ],
        },
        Types: {
          buckets: [
            { key: 'code', numberOfFiles: { value: 1757618 } },
            { key: 'doc', numberOfFiles: { value: 68943 } },
          ],
        },
      },
    });

    const result = await listIndices();
    const expected = `Index: kibana-repo
- Files: 73,843 total
- Symbols: 226,763 total
- Languages: typescript (63.5K files), javascript (3.5K files)
- Content: code (1.8M files), doc (68.9K files)
---
Index: grafana-repo
- Files: 73,843 total
- Symbols: 226,763 total
- Languages: typescript (63.5K files), javascript (3.5K files)
- Content: code (1.8M files), doc (68.9K files)`;

    expect((result.content[0] as TextContent).text.trim()).toEqual(expected.trim());
    expect(mockClient.indices.getAlias).toHaveBeenCalledWith({
      name: '*-repo',
    });
    expect(mockClient.search).toHaveBeenCalledTimes(2);
  });
});
