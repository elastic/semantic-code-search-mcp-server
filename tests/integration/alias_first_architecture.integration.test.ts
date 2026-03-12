import type { MappingTypeMapping } from '@elastic/elasticsearch/lib/api/types';

describe('Integration Test - MCP alias-first contract (live Elasticsearch)', () => {
  it('should list indices via *_locations aliases and reconstruct file content', async () => {
    const unique = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const aliasName = `mcp-alias-first-${unique}`;
    const backingIndex = `${aliasName}-scsi-${unique}`;
    const backingLocationsIndex = `${backingIndex}_locations`;

    process.env.ELASTICSEARCH_ENDPOINT = 'http://localhost:9200';
    process.env.ELASTICSEARCH_USER = 'elastic';
    process.env.ELASTICSEARCH_PASSWORD = 'testpassword';
    process.env.ELASTICSEARCH_INDEX = aliasName;

    jest.resetModules();

    const { client } = await import('../../src/utils/elasticsearch');
    const { listIndices } = await import('../../src/mcp_server/tools/list_indices');
    const { readFile } = await import('../../src/mcp_server/tools/read_file');
    const { mapSymbolsByQuery } = await import('../../src/mcp_server/tools/map_symbols_by_query');

    const nowIso = () => new Date().toISOString();

    const chunkMappings = {
      properties: {
        type: { type: 'keyword' },
        language: { type: 'keyword' },
        kind: { type: 'keyword' },
        imports: {
          type: 'nested',
          properties: {
            path: { type: 'keyword' },
            type: { type: 'keyword' },
            symbols: { type: 'keyword' },
          },
        },
        symbols: {
          type: 'nested',
          properties: {
            name: { type: 'keyword' },
            kind: { type: 'keyword' },
            line: { type: 'integer' },
          },
        },
        exports: {
          type: 'nested',
          properties: {
            name: { type: 'keyword' },
            type: { type: 'keyword' },
            target: { type: 'keyword' },
          },
        },
        containerPath: { type: 'text' },
        chunk_hash: { type: 'keyword' },
        content: { type: 'text' },
        semantic_text: { type: 'text' },
        created_at: { type: 'date' },
        updated_at: { type: 'date' },
      },
    } as const satisfies MappingTypeMapping;

    const locationsMappings = {
      properties: {
        chunk_id: { type: 'keyword' },
        filePath: { type: 'wildcard' },
        startLine: { type: 'integer' },
        endLine: { type: 'integer' },
        directoryPath: { type: 'keyword', eager_global_ordinals: true },
        directoryName: { type: 'keyword' },
        directoryDepth: { type: 'integer' },
        git_file_hash: { type: 'keyword' },
        git_branch: { type: 'keyword' },
        updated_at: { type: 'date' },
      },
    } as const satisfies MappingTypeMapping;

    const chunk1Id = 'c1';
    const chunk2Id = 'c2';
    const filePath = 'src/file.ts';

    try {
      await client.indices.create({ index: backingIndex, mappings: chunkMappings });
      await client.indices.create({ index: backingLocationsIndex, mappings: locationsMappings });

      await client.indices.updateAliases({
        actions: [
          { add: { index: backingIndex, alias: aliasName } },
          { add: { index: backingLocationsIndex, alias: `${aliasName}_locations` } },
        ],
      });

      await client.index({
        index: backingIndex,
        id: chunk1Id,
        document: {
          type: 'code',
          language: 'typescript',
          kind: 'function_declaration',
          imports: [{ path: 'react', type: 'module', symbols: ['useState'] }],
          symbols: [{ name: 'Foo', kind: 'function_declaration', line: 1 }],
          exports: [{ name: 'Foo', type: 'named' }],
          containerPath: '',
          chunk_hash: 'h1',
          content: 'A',
          semantic_text: 'A',
          created_at: nowIso(),
          updated_at: nowIso(),
        },
        refresh: true,
      });

      await client.index({
        index: backingIndex,
        id: chunk2Id,
        document: {
          type: 'code',
          language: 'typescript',
          kind: 'function_declaration',
          symbols: [{ name: 'Bar', kind: 'function_declaration', line: 3 }],
          exports: [{ name: 'Bar', type: 'named' }],
          containerPath: '',
          chunk_hash: 'h2',
          content: 'B',
          semantic_text: 'B',
          created_at: nowIso(),
          updated_at: nowIso(),
        },
        refresh: true,
      });

      await client.index({
        index: backingLocationsIndex,
        id: 'l1',
        document: {
          chunk_id: chunk1Id,
          filePath,
          startLine: 1,
          endLine: 1,
          directoryPath: 'src',
          directoryName: 'src',
          directoryDepth: 1,
          git_branch: 'main',
          updated_at: nowIso(),
        },
        refresh: true,
      });

      await client.index({
        index: backingLocationsIndex,
        id: 'l2',
        document: {
          chunk_id: chunk2Id,
          filePath,
          startLine: 3,
          endLine: 3,
          directoryPath: 'src',
          directoryName: 'src',
          directoryDepth: 1,
          git_branch: 'main',
          updated_at: nowIso(),
        },
        refresh: true,
      });

      // 1) list_indices discovers via *_locations aliases (no -repo assumptions).
      const listResult = await listIndices();
      const listText = listResult.content[0]?.type === 'text' ? listResult.content[0].text : '';
      expect(listText).toContain(`Index: ${aliasName} (Default)`);
      expect(listText).toContain('- Files: 1 total');

      // 2) read_file_from_chunks joins <alias>_locations -> <alias>.
      const readResult = await readFile({ filePaths: [filePath] });
      const fileText = readResult.content[0]?.type === 'text' ? readResult.content[0].text : '';
      expect(fileText).toContain(`File: ${filePath}`);
      expect(fileText).toContain('A\n// (1 lines omitted)\nB');

      // 3) map_symbols_by_query joins chunk ids to symbols.
      const mapResult = await mapSymbolsByQuery({ kql: `filePath: ${filePath}`, size: 1000 });
      expect(mapResult.content[0]?.type).toBe('text');
      const parsed = JSON.parse((mapResult.content[0] as { type: 'text'; text: string }).text) as Record<
        string,
        unknown
      >;
      expect(Object.keys(parsed)).toContain(filePath);
    } finally {
      // Best-effort cleanup.
      try {
        await client.indices.delete({ index: backingLocationsIndex });
      } catch {
        // ignore
      }
      try {
        await client.indices.delete({ index: backingIndex });
      } catch {
        // ignore
      }
    }
  });
});
