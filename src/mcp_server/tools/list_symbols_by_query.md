A direct querying tool for retrieving lists of symbols and imports. Use this when you need to gather all symbols and import statements from a known file path or when you want to find symbols based on specific, non-semantic attributes.

**Best for:**
*   **Targeted Retrieval:** Answering questions like, "What are all the symbols and imports in the `src/utils` directory?" or "Show me all exported functions."
*   **File-Based Exploration:** When you have a specific file or directory in mind and want to see all the symbols and imports it contains without a broad semantic search.
*   **Attribute-Based Filtering:** Finding symbols that match precise KQL criteria, such as `language: "typescript"` or `kind: "interface_declaration"`.

**Workflow:**
1.  Use this tool when you have a clear, KQL-filterable query for symbols.
2.  Provide a KQL query to retrieve a list of all matching symbols and imports.
3.  Analyze the resulting list to identify specific symbols of interest.
4.  Once you have identified a specific, concrete symbol, **switch to `symbol_analysis`** for a precise analysis of its connections.

**Example:**

To get all symbols in the `src/utils` directory, you would use the following query:

```json
{
  "kql": "filePath: *src/utils*"
}
```

**Output:**

The tool will return a JSON object where the keys are the file paths and the values are an object containing an array of symbols and an array of imports found in that file.

```json
{
  "src/utils/logger.ts": {
    "symbols": [
      {
        "name": "logger",
        "kind": "variable",
        "line": 10
      }
    ],
    "imports": [
      {
        "path": "winston",
        "type": "module",
        "symbols": [
          "createLogger",
          "format",
          "transports"
        ]
      }
    ]
  },
  "src/utils/elasticsearch.ts": {
    "symbols": [
      {
        "name": "client",
        "kind": "variable",
        "line": 5
      },
      {
        "name": "createIndex",
        "kind": "function",
        "line": 20
      }
    ],
    "imports": [
      {
        "path": "@elastic/elasticsearch",
        "type": "module",
        "symbols": [
          "Client"
        ]
      }
    ]
  }
}
```