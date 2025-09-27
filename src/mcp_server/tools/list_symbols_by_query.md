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
