Discovers significant directories in a codebase to help identify where important packages, modules, or components are located.

## Use Cases
- **Codebase Navigation**: Starting investigation in a new or unfamiliar codebase
- **Concept Discovery**: Find packages or modules related to a concept (e.g., "authentication", "data visualization")
- **Architecture Overview**: Identify the main components in a repository
- **Feature Location**: Locate directories containing specific functionality

## Workflow Position
Typically the **first step** when exploring a codebase:
1. **`discover_directories`** → find significant areas
2. `map_symbols_by_query` → explore files in those directories
3. `read_file_from_chunks` → read specific implementations

## Parameters
- `query` (optional): Semantic search query to find directories related to a concept
- `kql` (optional): Additional KQL filters (e.g., `"language: typescript"`)
- `minFiles` (optional): Minimum files threshold (default: 3)
- `maxResults` (optional): Maximum results to return (default: 20)
- `index` (optional): Specific Elasticsearch index to search

## Example Usage

**Find ESQL-related directories:**
```json
{
  "query": "ESQL parsing and utilities",
  "minFiles": 5
}
```

**Find TypeScript UI components:**
```json
{
  "query": "data grid table components",
  "kql": "language: typescript"
}
```

**Find authentication modules:**
```json
{
  "query": "authentication",
  "minFiles": 3
}
```

## Output Format
Returns a ranked list of directories with:
- **Directory path**: Full path in the repository
- **File count**: Number of files in the directory
- **Symbol count**: Total symbols indexed from the directory
- **Languages**: Programming languages used
- **Significance score**: Calculated importance metric
- **Key files**: Boundary markers like README.md, package.json ⭐

Directories with README files and package.json are ranked significantly higher.

## Significance Scoring
The tool ranks directories using multiple factors:
- File count (more files = more important)
- Symbol count (more symbols = more content)
- Language diversity (multiple languages = package boundary)
- Boundary markers (README, package.json, etc. = very significant)

## Example Output
```
Found 2 significant directories:

## src/platform/packages/shared/kbn-esql-utils
- **Files**: 45
- **Symbols**: 892
- **Languages**: typescript, markdown
- **Significance Score**: 235.2
- **Key Files**: README.md, package.json, index.ts ⭐

## src/platform/packages/shared/kbn-esql-ast
- **Files**: 38
- **Symbols**: 756
- **Languages**: typescript
- **Significance Score**: 215.6
- **Key Files**: README.md, package.json ⭐
```

**Note**: The `index` parameter is optional. Only specify it when you need to search a specific index different from the default.
