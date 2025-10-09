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
                  key: 'src/utils',
                  doc_count: 15,
                  file_count: { value: 10 },
                  symbol_count: { count: { value: 150 } },
                  languages: { buckets: [{ key: 'typescript', doc_count: 10 }] },
                  top_kinds: { buckets: [{ key: 'function_declaration', doc_count: 50 }] },
                  score: { value: 9.555555 }
                },
                {
                  key: 'src/components',
                  doc_count: 20,
                  file_count: { value: 15 },
                  symbol_count: { count: { value: 200 } },
                  languages: { buckets: [{ key: 'typescript', doc_count: 15 }] },
                  top_kinds: { buckets: [{ key: 'class_declaration', doc_count: 30 }] },
                  score: { value: 7.5555555 }
                }
              ]
            }
          }
        })
      };

      const results = await discoverSignificantDirectories(
        mockClient as unknown as Client,
        'test-index',
        { minFiles: 3, maxResults: 10 }
      );

      expect(results).toHaveLength(2);
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect(results[0].path).toBe('src/utils');
    });

    it('should handle empty results', async () => {
      const mockClient = {
        search: jest.fn().mockResolvedValue({
          aggregations: {
            directories: {
              buckets: []
            }
          }
        })
      };

      const results = await discoverSignificantDirectories(
        mockClient as unknown as Client,
        'test-index',
        {}
      );

      expect(results).toEqual([]);
    });

    it('should use query parameters correctly', async () => {
      const mockClient = {
        search: jest.fn().mockResolvedValue({
          aggregations: {
            directories: {
              buckets: []
            }
          }
        })
      };

      const query = { bool: { must: [{ match: { content: 'test' } }] } };
      await discoverSignificantDirectories(
        mockClient as unknown as Client,
        'test-index',
        { query, minFiles: 5, maxResults: 20 }
      );

      expect(mockClient.search).toHaveBeenCalledWith({
        index: 'test-index',
        query,
        size: 0,
        aggs: expect.objectContaining({
          directories: expect.objectContaining({
            terms: expect.objectContaining({
              field: 'directoryPath',
              size: 20,
              min_doc_count: 5,
              order: { score: 'desc' }
            }),
            aggs: expect.objectContaining({
              score: expect.objectContaining({
                avg: expect.objectContaining({
                  script: { source: '_score' }
                })
              })
            })
          })
        })
      });
    });
  });
});
