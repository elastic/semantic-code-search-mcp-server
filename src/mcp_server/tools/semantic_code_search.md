## Investigation Workflow

**1. Semantic Discovery** - Find relevant code with conceptual queries
```json
{ "query": "your concept here", "kql": "kind: \"function_declaration\"", "size": 25 }
```

**2. Symbol Analysis** - Deep dive on discovered symbols
```json
{ "symbolName": "SymbolYouFound" }
```

**3. Map Symbols** - Get structured overview of related code
```json
{ "kql": "\"ActualSymbol\" and (relatedSymbol1 or relatedSymbol2)" }
```

**4. Read Code** - Get full context
```json
{ "filePaths": ["paths/from/above.ts"] }
```

---

## Parameters
- `query`: The semantic seach phrase based on the concept
- `kql`: The KQL query string using **actual symbol names** (not generic terms)
- `index`: (Optional) Specify only when searching across multiple indices. Omit to use the default index.

---

## Tool Selection

**semantic_code_search**: First search to discover concepts and symbols. Returns code snippets with relevance scores.

**symbol_analysis**: Once you find a key symbol, get complete usage map (definitions, usages, imports, docs).

**map_symbols_by_query**: After symbol_analysis, use actual symbol names in KQL to get structured file-by-file view. Shows which files have the most relevant code (more symbols = more relevant).

**read_file_from_chunks**: Read full implementations once you've identified the key files.

---

## When to Use What

**semantic_code_search**: Don't know symbol names, exploring concepts
**symbol_analysis**: Found key symbols, need complete usage map
**map_symbols_by_query**: Know exact symbols, need structured file overview
**Combine**: Semantic + KQL filters for discovery, then map_symbols for structure

---

## KQL Syntax

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

Use `get_distinct_values` to see all available kinds in your index.

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

---

## Key Principles

✅ Start broad (semantic) → analyze key symbols → map with actual names → read files
✅ Use **map_symbols_by_query** with actual symbol names from symbol_analysis
✅ Files with more symbols in map_symbols results = more relevant
✅ Each search informs the next - build incrementally
✅ Only supply an `index` WHEN the user asks for a differnt index
✅ Use same `index` parameter IF working across multiple indices

❌ Don't copy example queries - extract the pattern
❌ Don't use generic KQL terms like "handler" or "manager" - use actual discovered symbols
❌ Don't skip symbol_analysis when you find important symbols
❌ Don't use semantic_code_search for structured queries - use map_symbols_by_query

---

## Quick Patterns

**Architecture discovery**:
```
semantic_code_search → symbol_analysis → map_symbols_by_query → read_file_from_chunks
```

**Find related code**:
```
symbol_analysis (get related symbols) → map_symbols_by_query (structured view)
```

**Data flow**:
```
semantic_code_search (entry point) → symbol_analysis (chain) → read_file_from_chunks
```

---

## Example Progression

```json
// 1. Discover concept
{ "query": "filter events LensEmbeddable" }
// → Found: onFilter, prepareEventHandler, LensPublicCallbacks

// 2. Analyze key symbol
{ "symbolName": "onFilter" }
// → Found related: LensPublicCallbacks, PreventableEvent, prepareEventHandler

// 3. Map with actual symbols (not generic terms!)
{ "kql": "\"onFilter\" and (LensPublicCallbacks or PreventableEvent or prepareEventHandler)" }
// → Returns structured file-by-file view with symbol counts

// 4. Read the most relevant files
{ "filePaths": ["path/with/most/symbols.ts"] }
```

**Note**: Step 3 uses actual symbol names discovered in steps 1-2, NOT generic terms like "lens" or "embeddable".
