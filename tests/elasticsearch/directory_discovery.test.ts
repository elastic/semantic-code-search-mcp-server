import { discoverSignificantDirectories } from '../../src/elasticsearch/directory_discovery';
import { Client } from '@elastic/elasticsearch';

describe('directory_discovery', () => {
  describe('discoverSignificantDirectories', () => {
    it('should return directories sorted by score', async () => {
      const mockClient = {
        search: jest.fn().mockResolvedValue({
          aggregations: {
            directories: {
              buckets: [
                {
                  key: 'src/components',
                  doc_count: 20,
                  file_count: { value: 15 },
                  top_chunks: { buckets: [{ key: 'c2', doc_count: 3 }] },
                },
                {
                  key: 'src/utils',
                  doc_count: 15,
                  file_count: { value: 10 },
                  top_chunks: { buckets: [{ key: 'c1', doc_count: 5 }] },
                },
              ],
            },
          },
        }),
        mget: jest.fn().mockResolvedValue({
          docs: [
            { _id: 'c1', found: true, _source: { language: 'typescript', kind: 'function_declaration', symbols: [] } },
            { _id: 'c2', found: true, _source: { language: 'typescript', kind: 'class_declaration', symbols: [] } },
          ],
        }),
      };

      const results = await discoverSignificantDirectories(mockClient as unknown as Client, 'test-index', {
        minFiles: 3,
        maxResults: 10,
      });

      expect(results).toHaveLength(2);
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect(results[0].path).toBe('src/components');
    });

    it('should handle empty results', async () => {
      const mockClient = {
        search: jest.fn().mockResolvedValue({
          aggregations: {
            directories: {
              buckets: [],
            },
          },
        }),
        mget: jest.fn().mockResolvedValue({ docs: [] }),
      };

      const results = await discoverSignificantDirectories(mockClient as unknown as Client, 'test-index', {});

      expect(results).toEqual([]);
    });

    it('should use query parameters correctly', async () => {
      const mockClient = {
        search: jest.fn().mockResolvedValue({
          aggregations: {
            directories: {
              buckets: [],
            },
          },
        }),
        mget: jest.fn().mockResolvedValue({ docs: [] }),
      };

      const query = { bool: { must: [{ match: { content: 'test' } }] } };
      await discoverSignificantDirectories(mockClient as unknown as Client, 'test-index', {
        locationQuery: query,
        minFiles: 5,
        maxResults: 20,
      });

      expect(mockClient.search).toHaveBeenCalledWith({
        index: 'test-index_locations',
        query: { bool: { must: [query] } },
        size: 0,
        aggs: expect.objectContaining({
          directories: expect.objectContaining({
            terms: expect.objectContaining({
              field: 'directoryPath',
              size: 20,
              min_doc_count: 5,
            }),
          }),
        }),
      });
    });
  });
});
