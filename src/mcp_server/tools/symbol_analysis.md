Precision tool for step 2 of "chain of investigation" - analyze specific symbols found via search.

## Use Cases
- **Deep Dive**: "Where is `IndicatorType` used and how?"
- **Architecture**: See definition, imports, call sites, tests, docs
- **Impact**: Find all affected locations for changes

## Workflow
1. Find symbols via `semantic_code_search` or `map_symbols_by_query`
2. Pass exact symbol name to `symbol_analysis` for complete connections

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
