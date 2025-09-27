Reconstruct file content from indexed chunks when you have a file path.

## Parameters
`filePaths` (`string[]`): Array of relative file paths

## Returns
Map of file paths to chunk arrays:

```json
{
  "path/to/file.js": [
    {
      "content": "import { useState } from 'react';",
      "startLine": 1,
      "endLine": 1,
      "kind": "import_statement"
    },
    {
      "content": "const MyComponent = () => {",
      "startLine": 3,
      "endLine": 3,
      "kind": "lexical_declaration"
    }
  ]
}
```

## Chunk Properties
- `content`: Source code text
- `startLine`: Beginning line number
- `endLine`: Ending line number
- `kind`: Tree-sitter node type (e.g., `function_declaration`, `import_statement`)
