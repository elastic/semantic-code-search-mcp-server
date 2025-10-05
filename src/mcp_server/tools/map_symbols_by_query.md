Query for a structured map of files containing specific symbols, grouped by file path.

## Use Cases
- **Post-Discovery Analysis**: After `symbol_analysis` reveals related symbols, use this tool with actual symbol names to see which files contain them
- **Architecture Overview**: Get a file-by-file breakdown showing symbol counts (more symbols = more relevant)
- **Finding Implementations**: Locate files that use multiple related symbols together
- **Code Organization**: See how symbols are distributed across the codebase

## When to Use
- You have specific symbol names from `symbol_analysis` or `semantic_code_search`
- You want to see which files are most relevant (contains most related symbols)
- You need a structured view before diving into full file contents
- You're mapping the relationship between multiple symbols

## When NOT to Use
- You don't know any symbol names yet (use `semantic_code_search` first)
- You need the full file content (use `read_file_from_chunks`)
- You want complete usage information for a single symbol (use `symbol_analysis`)

## Workflow Position
Typically the **third step** in investigation:
1. `semantic_code_search` → discover symbols
2. `symbol_analysis` → understand one key symbol's relationships
3. **`map_symbols_by_query`** → see which files combine related symbols
4. `read_file_from_chunks` → read the most relevant files

## Parameters
- `kql`: The KQL query string using **actual symbol names** (not generic terms)
- `index`: (Optional) Specify only when searching across multiple indices. Omit to use the default index.
- `size`: (Optional) Then number of top level files to return (default: 1000)

## Example Workflow
```json
// After symbol_analysis on "onFilter" revealed: LensPublicCallbacks, PreventableEvent
{ "kql": "\"onFilter\" and (LensPublicCallbacks or PreventableEvent)" }
```

## Output Format
Returns a JSON object where:
- **Keys**: File paths
- **Values**:
  - `symbols`: Grouped by kind (function.call, variable.name, etc.) with line numbers
  - `imports`: Module imports with their symbols

Files with **more symbol matches** are typically more relevant to your investigation.

## Output Example
```json
{
  "src/path/to/file.ts": {
    "symbols": {
      "function.call": [
        { "name": "onFilter", "line": 42 }
      ],
      "variable.name": [
        { "name": "eventHandler", "line": 35 }
      ]
    },
    "imports": {
      "module": [
        {
          "path": "@kbn/types",
          "symbols": ["LensPublicCallbacks"]
        }
      ]
    }
  }
}
```

**Note**: Symbols are grouped by type (function.call, variable.name, etc.) rather than a flat array.

**Note**: The `index` parameter is optional. Only specify it when you need to search a specific index different from the default.
