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
