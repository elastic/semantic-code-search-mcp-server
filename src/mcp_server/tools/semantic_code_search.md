Start your "chain of investigation" with broad semantic exploration.

## Use Cases
- **Discovery**: "Where is SLO SLI logic?" / "How are API keys handled?"
- **Entry Points**: Broad queries → relevant files → specific symbols
- **Refinement**: Narrow with specific terms or KQL filters

## Workflow
1. Broad semantic query → understand landscape
2. Identify key files/symbols
3. Switch to `symbol_analysis` for specific symbols

## Parameters
- `query`: Semantic search terms
- `kql`: Filter expression (combined with AND if both provided)
- `size`: Results per page
- `page`: Pagination
- `index`: The Elasticsearch index to search (optional)

## KQL Fields
**Basic**: `type`, `language`, `kind`, `filePath`, `containerPath`, `startLine`, `endLine`
**Imports**: `imports.path`, `imports.type`, `imports.symbols`
**Symbols**: `symbols.name`, `symbols.kind`, `symbols.line`
**Timestamps**: `created_at`, `updated_at`

## Query Rules
- Use semantic terms from user's actual question
- Show search parameters: `query: "X"` and `kql: "Y"`
- Wildcards: NO quotes for patterns, quotes for EXACT matches only
- Use `content: "symbol-name"` for exact symbol matches
- Check `get_distinct_values` for valid `kind` values

## Examples
```json
// Semantic + KQL
{ "query": "render a table", "kql": "kind: \"function_declaration\"" }

// KQL only
{ "kql": "language: \"typescript\" and kind: \"class_declaration\"", "size": 5 }

// Wildcard search (no quotes on wildcard)
{ "kql": "filePath: *src/utils*" }

// Exact match (with quotes)
{ "kql": "content: \"getUserData\"" }

// Nested query for exact symbol name
{ "kql": "symbols: { name: \"EuiSpacer\" }" }

// Combined wildcard and exact
{ "kql": "filePath: *components* and kind: \"function_declaration\"" }

// Pagination
{ "query": "state management", "size": 50, "page": 2 }
```
**Note:** The `index` used in this search **MUST** be passed to all subsequent tools (`symbol_analysis`, `read_file_from_chunks`, etc.) to ensure they query the same codebase.