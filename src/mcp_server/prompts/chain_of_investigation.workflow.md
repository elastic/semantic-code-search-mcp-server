# WORKFLOW

**Know symbol names?** → Use `map_symbols_by_query`
**Exploring concepts?** → Use `semantic_code_search`

---

## Tool Selection

### map_symbols_by_query 🎯
**Primary tool when you know symbol names**
- Returns ALL matching files (not limited to 25)
- Shows symbol density (more symbols = more relevant)
- Structured output with line numbers and imports
- Best for: Finding files using specific symbols, co-occurrence patterns

### semantic_code_search
**For discovering symbols**
- Returns top 25 snippets with relevance scores
- Good for conceptual queries
- Best for: "How does X work?", exploring unfamiliar code

### symbol_analysis
**Deep dive on one symbol**
- Shows definitions, usages, types, documentation
- Reveals related symbols for next search
- Best for: Understanding a key symbol completely

### read_file_from_chunks
**Get full implementation**
- Reconstructs complete files
- Best for: Reading identified files

---

## Common Workflows

**User mentions specific names** (e.g., "How does onFilter work?")
```
map_symbols_by_query → symbol_analysis (optional) → read_file_from_chunks
```

**User asks conceptual question** (e.g., "How is auth handled?")
```
semantic_code_search → symbol_analysis → map_symbols_by_query → read_file_from_chunks
```

**Deep investigation**
```
symbol_analysis → map_symbols_by_query (with related symbols) → read_file_from_chunks
```

---

## KQL Quick Reference

**Boolean**: `and`, `or`, `not` with `(parentheses)`
**Exact**: `"quoted"` | **Substring**: unquoted
**Wildcards**: `filePath: *pattern*` (no quotes)
**Fields**: `content:`, `filePath:`, `kind:`, `language:`

Common kinds: `function_declaration`, `class_declaration`, `interface_declaration`, `type_alias_declaration`

---

## Key Rules

✅ Know symbol names → start with `map_symbols_by_query`
✅ Use actual symbol names from analysis, not generic terms
✅ Files with more symbols = more relevant
✅ Only supply an `index` WHEN the user asks for a differnt index
✅ Use same `index` parameter IF working across multiple indices

❌ Don't use `semantic_code_search` when you know symbols
❌ Don't use generic KQL terms like "handler" or "manager"
❌ Don't paginate semantic results - use `map_symbols_by_query`

---

## Why map_symbols > semantic

| When you know symbols | semantic_code_search | map_symbols_by_query |
|----------------------|---------------------|---------------------|
| Coverage | 25 snippets max | All files |
| Co-occurrence | Hard to find | Shows which files have both |
| Imports | Not shown | Explicit section |
| Relevance | Score | Symbol count |

**Rule**: User mentions names → `map_symbols_by_query` | User describes concepts → `semantic_code_search`
