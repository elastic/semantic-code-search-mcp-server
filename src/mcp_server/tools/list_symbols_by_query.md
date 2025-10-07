Direct KQL querying for symbols and imports from known paths or attributes.

## Use Cases
- **Targeted Retrieval**: "All symbols in `src/utils`" / "All exported functions"
- **File Exploration**: Specific file/directory symbols without semantic search
- **Attribute Filtering**: Precise KQL matches like `kind: "interface_declaration"`

## Workflow
1. Use when you have a KQL-filterable query
2. Retrieve matching symbols and imports
3. Identify specific symbols of interest
4. Switch to `symbol_analysis` for deep connections

## Parameters
- `kql`: The KQL query string.
- `index`: The Elasticsearch index to search (optional).

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

## Example Query
```json
{ "kql": "filePath: *src/plugins*" }
```

## Output Format
Returns file paths mapped to symbols and imports:

```json
{
  "src/core/packages/plugins/server-mocks/src/plugins_service.mock.ts": {
    "symbols": {
      "function.call": [
        { "name": "lazyObject", "line": 42 },
        { "name": "createInternalSetupContractMock", "line": 36 }
      ],
      "variable.name": [
        { "name": "createServiceMock", "line": 31 },
        { "name": "createSetupContractMock", "line": 41 }
      ],
      "type.name": [
        { "name": "PluginsServiceMock", "line": 19 }
      ]
    },
    "imports": {
      "module": [
        {
          "path": "@kbn/core-plugins-contracts-server",
          "symbols": ["PluginsServiceSetup", "PluginsServiceStart"]
        }
      ]
    }
  }
}
```

**Note**: Symbols are grouped by type (function.call, variable.name, etc.) rather than a flat array.
**Note:** Requires the same `index` used in the initial `semantic_code_search` to maintain context.