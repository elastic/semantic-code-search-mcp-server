# List Indices

## Description

Lists available Elasticsearch indices that are hosted on the same Elasticsearch cluster as the default configured `ELASTICSEARCH_INDEX`.

This tool allows LLMs to query for available indices and get a summary of their contents.

## Discovery Strategy

The tool uses a dual discovery strategy to find repository indices:

1. **Primary**: Discovers indices via aliases ending with `-repo` (backward compatible)
2. **Fallback**: Discovers indices via `_settings` pattern when aliases are not available

Both methods are attempted, and results are merged and deduplicated. If the same index is found via both methods, the alias-based entry takes precedence.

## Output Format

The tool displays:
- **Index name**: Shows the actual index name (e.g., `kibana`), not the alias (e.g., `kibana-repo`)
- **Default indicator**: Marks the index matching `ELASTICSEARCH_INDEX` as `(Default)`
- **Statistics**: For each index:
  - Total number of files indexed
  - Total number of symbols
  - Languages breakdown with file counts
  - Content types breakdown with file counts

## Example Output

```
Index: kibana (Default)
- Files: 1,500 total
- Symbols: 3,200 total
- Languages: typescript (1,200 files), javascript (300 files)
- Content: function_declaration (800 files), class_declaration (200 files)
---
Index: grafana
- Files: 800 total
- Symbols: 1,500 total
- Languages: go (600 files), typescript (200 files)
- Content: function_declaration (500 files), type_declaration (100 files)
```

## Error Handling

- If alias discovery fails, the tool falls back to `_settings` discovery
- If both methods fail, returns a message indicating no indices were found
- Individual index query errors are logged but don't stop the entire operation
- Indices without valid aggregations are skipped from the output
