# List Indices

## Description

Lists available Elasticsearch indices that are hosted on the same Elasticsearch cluster as the default configured `ELASTICSEARCH_INDEX`.

This tool allows LLMs to query for available indices and get a summary of their contents.

## Notes (locations-first indices)

This MCP server expects the locations-first model:

- `<index>`: content-deduplicated chunk documents
- `<index>_locations`: one document per chunk occurrence, including `filePath`

For this tool, **file counts are computed from `<index>_locations`** using a `cardinality(filePath)` aggregation, because chunk documents do not store per-file metadata.

## Output

Returns a human-readable list of indices with:

- Files: approximate count of unique file paths in `<index>_locations`
- Symbols: approximate unique symbol count from `<index>` (nested `symbols`)
- Languages / Content: rough breakdowns from `<index>`
