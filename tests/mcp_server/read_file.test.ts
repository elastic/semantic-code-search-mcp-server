import { readFile } from '../../src/mcp_server/tools/read_file';
import { client, isIndexNotFoundError, formatIndexNotFoundError } from '../../src/utils/elasticsearch';

jest.mock('../../src/utils/elasticsearch', () => ({
  client: {
    search: jest.fn(),
    indices: {
      getAlias: jest.fn(),
      exists: jest.fn(),
    },
    mget: jest.fn(),
  },
  elasticsearchConfig: {
    index: 'test-index',
  },
  isIndexNotFoundError: jest.fn(),
  formatIndexNotFoundError: jest.fn(),
  getLocationsIndexName: (index: string) => `${index}_locations`,
  getChunksById: jest.fn(),
}));

describe('read_file_from_chunks', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should reconstruct using location docs joined to chunk docs', async () => {
    const { getChunksById } = jest.requireMock('../../src/utils/elasticsearch') as { getChunksById: jest.Mock };
    getChunksById.mockResolvedValue({
      c1: { content: 'A', kind: 'function_declaration' },
      c2: { content: 'B', kind: 'function_declaration' },
    });

    (client.search as jest.Mock).mockImplementation(
      (req: { index?: string; query?: { term?: { filePath?: string } }; search_after?: unknown }) => {
        if (req.index !== 'test-index_locations') {
          return Promise.resolve({ hits: { hits: [] } });
        }
        const filePath = req.query?.term?.filePath;
        if (req.search_after) {
          return Promise.resolve({ hits: { hits: [] } });
        }
        if (filePath === 'file1.ts') {
          return Promise.resolve({
            hits: {
              hits: [
                { _id: 'l1', _source: { chunk_id: 'c1', filePath: 'file1.ts', startLine: 1, endLine: 1 }, sort: [1] },
                { _id: 'l2', _source: { chunk_id: 'c2', filePath: 'file1.ts', startLine: 3, endLine: 3 }, sort: [3] },
              ],
            },
          });
        }
        if (filePath === 'file2.ts') {
          return Promise.resolve({
            hits: {
              hits: [
                {
                  _id: 'l3',
                  _source: { chunk_id: 'c1', filePath: 'file2.ts', startLine: 50, endLine: 50 },
                  sort: [50],
                },
                {
                  _id: 'l4',
                  _source: { chunk_id: 'c2', filePath: 'file2.ts', startLine: 52, endLine: 52 },
                  sort: [52],
                },
              ],
            },
          });
        }
        return Promise.resolve({ hits: { hits: [] } });
      }
    );

    const result = await readFile({ filePaths: ['file1.ts', 'file2.ts'] });

    const findFileText = (prefix: string): string | undefined => {
      const entry = result.content.find(
        (c) => c.type === 'text' && typeof c.text === 'string' && c.text.startsWith(prefix)
      );
      return entry?.type === 'text' && typeof entry.text === 'string' ? entry.text : undefined;
    };

    const file1Text = findFileText('File: file1.ts');
    const file2Text = findFileText('File: file2.ts');

    expect(file1Text).toContain('File: file1.ts');
    expect(file1Text).toContain('A\n// (1 lines omitted)\nB');

    expect(file2Text).toContain('File: file2.ts');
    expect(file2Text).toContain('// (49 lines omitted)\nA\n// (1 lines omitted)\nB');
  });

  it('should return file not found message when no matching filePaths entry exists', async () => {
    (client.search as jest.Mock)
      .mockResolvedValueOnce({ hits: { hits: [] } })
      .mockResolvedValueOnce({ hits: { hits: [] } });

    const result = await readFile({ filePaths: ['missing.ts'] });
    expect(result.content[0].text).toContain('File: missing.ts');
    expect(result.content[0].text).toContain('File not found in index');
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

    (client.search as jest.Mock).mockReset().mockRejectedValue(indexNotFoundError);
    (isIndexNotFoundError as jest.Mock).mockReturnValue(true);
    (formatIndexNotFoundError as jest.Mock).mockResolvedValue(
      "The index 'nonexistent-index' was not found.\n\nAvailable indices:\n- test-index (100 files)"
    );

    const result = await readFile({
      filePaths: ['src/index.ts'],
      index: 'nonexistent-index',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("The index 'nonexistent-index' was not found.");
    expect(result.content[0].text).toContain('Available indices:');
  });
});
