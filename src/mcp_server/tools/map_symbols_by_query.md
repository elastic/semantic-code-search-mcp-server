Query for a structured map of files containing specific symbols, grouped by file path.

## Two Ways to Use This Tool

### 1. Directory Exploration (Recommended after discover_directories)
Use the `directory` parameter to explore a specific directory:
```json
{ "directory": "src/platform/packages/kbn-esql-utils" }
```

### 2. Advanced Filtering with KQL
Use the `kql` parameter for complex queries:
```json
{ "kql": "language: typescript and kind: function_declaration" }
```

**Important**: You cannot use both `directory` and `kql` together - choose the one that fits your need.

## Notes (locations-first indices)

This MCP server expects the locations-first model:

- `<index>`: content-deduplicated chunk documents (symbols/imports/exports live here)
- `<index>_locations`: one document per chunk occurrence (filePath/directoryPath live here)

When your KQL includes file-level fields (like `filePath`), those predicates are evaluated against `<index>_locations` and then joined back to `<index>` via `chunk_id`.

## Typical Workflow
1. `discover_directories` → finds "src/platform/packages/kbn-esql-utils"
2. `map_symbols_by_query` → explore that directory with `{ "directory": "src/platform/packages/kbn-esql-utils" }`
3. `read_file_from_chunks` → read specific files discovered

## Use Cases
- **Post-Discovery Analysis**: After `discover_directories` reveals significant directories, use this tool to explore them
- **Architecture Overview**: Get a file-by-file breakdown showing symbol counts (more symbols = more relevant)
- **Finding Implementations**: Locate files that use multiple related symbols together
- **Code Organization**: See how symbols are distributed across the codebase

## When to Use
- After using `discover_directories` to find significant directories
- You have specific symbol names from `symbol_analysis` or `semantic_code_search`
- You want to see which files are most relevant (contains most related symbols)
- You need a structured view before diving into full file contents

## When NOT to Use
- You don't know what you're looking for yet (use `semantic_code_search` first)
- You need the full file content (use `read_file_from_chunks`)
- You want complete usage information for a single symbol (use `symbol_analysis`)

## Parameters
- `directory` (optional): Directory path to explore (e.g., "src/platform/packages/kbn-esql-utils")
- `kql` (optional): KQL query string for advanced filtering
- `size` (optional): Maximum files to return (default: 1000)
- `index` (optional): Specific index to search

**Note**: Must provide either `directory` or `kql`, but not both.

## KQL Quick Reference

### Fields
- `content:` - Text in files (quoted: `content: "auth"`)
- `filePath:` - Paths with wildcards (NO quotes: `filePath: *test*`)
- `kind:` - Symbol type (quoted: `kind: "function_declaration"`)
- `language:` - Language (no quotes: `language: python`)

### Syntax Rules

**Wildcards - NO QUOTES:**
- ✅ `filePath: *test*`
- ❌ `filePath: "*test*"`

**Boolean - lowercase:**
- ✅ `language: python and kind: "function_declaration"`
- ❌ `language: python AND kind: "function_declaration"`
- Use: `and`, `or`, `not`, `(parentheses)`

**Common Kinds:**
`function_declaration`, `class_declaration`, `interface_declaration`, `method_definition`, `call_expression`, `type_alias_declaration`

### Common Patterns

**By file type:**
```
language: typescript
filePath: *.sql
```

**By directory:**
```
filePath: *services*
filePath: *test* and language: javascript
```

**By symbol:**
```
kind: "function_declaration"
kind: "class_declaration" and language: python
```

**By content:**
```
content: "authenticate"
"UserService" and language: typescript
```

**Combined:**
```
kind: "function_declaration" and content: "async" and filePath: *api*
language: python and not filePath: *test*
```

### Strategy

1. **Start simple, add filters incrementally**
2. **Use semantic search for concepts**, KQL for structure
3. **If no results**: remove filters, simplify query

### Common Mistakes

1. ❌ Quoting wildcards: `filePath: "*test*"` → ✅ `filePath: *test*`
2. ❌ Uppercase operators: `AND` → ✅ `and`
3. ❌ Missing quotes on kind: `kind: function` → ✅ `kind: "function_declaration"`

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
  - `exports`: Grouped by type (named, default, namespace) with optional target

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
    },
    "exports": {
      "named": [
        { "name": "myFunction" },
        { "name": "MyClass" }
      ],
      "default": [
        { "name": "UserService" }
      ],
      "namespace": [
        { "name": "*", "target": "src/types" }
      ]
    }
  }
}
```

**Note**: Symbols are grouped by type (function.call, variable.name, etc.) rather than a flat array.

**Note**: The `index` parameter is optional. Only specify it when you need to search a specific index different from the default.
