Precision tool for step 2 of "chain of investigation" - analyze specific symbols found via search.

## Use Cases
- **Deep Dive**: "Where is `IndicatorType` used and how?"
- **Architecture**: See definition, imports, call sites, tests, docs
- **Impact**: Find all affected locations for changes

## Workflow
1. Find symbols via `semantic_code_search` or `list_symbols_by_query`
2. Pass exact symbol name to `symbol_analysis` for complete connections

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
