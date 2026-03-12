Precision tool for step 2 of "chain of investigation" - analyze specific symbols found via search.

## Use Cases
- **Deep Dive**: "Where is `IndicatorType` used and how?"
- **Architecture**: See definition, imports, call sites, tests, docs
- **Impact**: Find all affected locations for changes

## Notes (locations-first indices)

Chunk documents in `<alias>` are content-deduplicated and do **not** store `filePath`/line metadata. This tool uses `<alias>_locations` to map chunk occurrences back to file paths.

## Workflow
1. Find symbols via `semantic_code_search` or `map_symbols_by_query`
2. Pass exact symbol name to `symbol_analysis` for complete connections

Under the hood (high level):

1. Search `<alias>` for chunk candidates related to the symbol name (yields `chunk_id`s).
2. Query `<alias>_locations` to find which `filePath`s contain those `chunk_id`s (and gather a few example locations).
3. Join back to `<alias>` (multi-get by `chunk_id`) to enrich results with chunk-level metadata (language/type/kind/content).

## Parameters
- `symbolName`: The name of the symbol to analyze.
- `index`: (Optional) Specify only when searching across multiple indices. Omit to use the default index.

## Returns
Comprehensive cross-referenced report showing:
- Definition location
- Import statements
- Usage/call sites
- Test references
- Documentation mentions

## Example
```json
{ "symbolName": "indicatorTypesSchema" }
```
**Note**: The `index` parameter is optional. Only specify it when you need to search a specific index different from the default.
