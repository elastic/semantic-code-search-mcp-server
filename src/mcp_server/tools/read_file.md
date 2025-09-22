Reads the content of a file from the index, providing a reconstructed view based on the most important indexed chunks. This tool is ideal when you have a file path and need to understand its contents without having direct file system access.

The tool returns a structured representation of the file, broken down into an array of "chunks." Each chunk is an object containing a piece of the file's content along with metadata about its location and syntactic kind.

## Parameters

- `filePaths` (`string[]`): An array of one or more relative file paths to the project to read.

## Returns

A map where each key is a file path and the value is an array of chunk objects. Each chunk object has the following properties:

- `content` (`string`): The source code content of the chunk.
- `startLine` (`number`): The line number where the chunk begins.
- `endLine` (`number`): The line number where the chunk ends.
- `kind` (`string`): The tree-sitter node type for the chunk (e.g., `function_declaration`, `import_statement`).

### Example Return

```json
{
  "path/to/your/file.js": [
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
    },
    {
      "content": "const [count, setCount] = useState(0);",
      "startLine": 4,
      "endLine": 4,
      "kind": "lexical_declaration"
    }
  ]
}
```
