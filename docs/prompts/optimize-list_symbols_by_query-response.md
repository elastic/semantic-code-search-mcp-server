## Status

This prompt document is **already implemented**: `map_symbols_by_query` returns `symbols`, `imports`, and `exports` grouped by their respective `kind`/`type`.

## Current Behavior (grouped output)

Output is a JSON object keyed by `filePath`. Each file contains grouped `symbols`/`imports`/`exports`:

```JSON
{
  "src/example.ts": {
    "symbols": {
      "function.call": [{ "name": "describe", "line": 10 }],
      "variable.name": [{ "name": "testCases", "line": 12 }]
    },
    "imports": {
      "module": [{ "path": "@kbn/foo", "symbols": ["bar"] }]
    },
    "exports": {
      "named": [{ "name": "myFunction" }]
    }
  }
}
```

### Note (locations-first indices)

Per-file association is computed from `<alias>_locations` (by aggregating `filePath` → `chunk_id`). Symbols/imports/exports are read from `<alias>` and joined via `chunk_id`.

## Historical Behavior (pre-grouped output)

The previous output shape grouped symbols as a single list (each entry had a `kind` field):

```JSON
{
  "src/platform/plugins/shared/metrics_experience/server/lib/fields/enrich_metric_fields.test.ts": {
    "symbols": [
      {
        "name": "expect",
        "kind": "function.call",
        "line": 142
      },
      {
        "name": "createMetricField",
        "kind": "function.call",
        "line": 149
      },
      {
        "name": "createMsearchResponse",
        "kind": "function.call",
        "line": 197
      },
      {
        "name": "enrichMetricFields",
        "kind": "function.call",
        "line": 135
      },
      {
        "name": "result",
        "kind": "variable.name",
        "line": 135
      },
      {
        "name": "createFieldCaps",
        "kind": "function.call",
        "line": 228
      },
      {
        "name": "metricFields",
        "kind": "variable.name",
        "line": 193
      },
      {
        "name": "it",
        "kind": "function.call",
        "line": 127
      },
      {
        "name": "describe",
        "kind": "function.call",
        "line": 88
      },
      {
        "name": "testCases",
        "kind": "variable.name",
        "line": 101
      },
      {
        "name": "Map",
        "kind": "class.instantiation",
        "line": 81
      },
      {
        "name": "NO_DATA_INDEX",
        "kind": "variable.name",
        "line": 33
      },
      {
        "name": "TEST_HOST_FIELD",
        "kind": "variable.name",
        "line": 34
      },
      {
        "name": "TEST_HOST_VALUE",
        "kind": "variable.name",
        "line": 35
      },
      {
        "name": "TEST_INDEX",
        "kind": "variable.name",
        "line": 32
      },
      {
        "name": "TEST_METRIC_NAME",
        "kind": "variable.name",
        "line": 31
      },
      {
        "name": "beforeEach",
        "kind": "function.call",
        "line": 71
      },
      {
        "name": "dataStreamFieldCapsMap",
        "kind": "variable.name",
        "line": 29
      },
      {
        "name": "esClientMock",
        "kind": "variable.name",
        "line": 24
      },
      {
        "name": "extractDimensionsMock",
        "kind": "variable.name",
        "line": 22
      },
      {
        "name": "logger",
        "kind": "variable.name",
        "line": 28
      },
      {
        "name": "msearchMock",
        "kind": "variable.name",
        "line": 23
      },
      {
        "name": "normalizeUnitMock",
        "kind": "variable.name",
        "line": 25
      }
    ],
    "imports": [
      {
        "path": ".repos/kibana/src/platform/plugins/shared/metrics_experience/common/types",
        "type": "file",
        "symbols": [
          "MetricField"
        ]
      },
      {
        "path": ".repos/kibana/src/platform/plugins/shared/metrics_experience/server/types",
        "type": "file",
        "symbols": [
          "DataStreamFieldCapsMap"
        ]
      },
      {
        "path": "@elastic/elasticsearch/lib/api/types",
        "type": "module",
        "symbols": [
          "FieldCapsFieldCapability"
        ]
      },
      {
        "path": ".repos/kibana/src/platform/plugins/shared/metrics_experience/server/lib/dimensions/extract_dimensions",
        "type": "file",
        "symbols": [
          "extractDimensions"
        ]
      },
      {
        "path": ".repos/kibana/src/platform/plugins/shared/metrics_experience/server/lib/fields/enrich_metric_fields",
        "type": "file",
        "symbols": [
          "enrichMetricFields"
        ]
      },
      {
        "path": ".repos/kibana/src/platform/plugins/shared/metrics_experience/server/lib/fields/normalize_unit",
        "type": "file",
        "symbols": [
          "normalizeUnit"
        ]
      }
    ]
  }
}
```

## Desired Behavior  

```JSON
{
  "src/platform/plugins/shared/metrics_experience/server/lib/fields/enrich_metric_fields.test.ts": {
    "symbols": {
      "function.call": [
        {"name": "expect", "line": 142},
        {"name": "createMetricField", "line": 149},
        {"name": "createMsearchResponse", "line": 197},
        {"name": "enrichMetricFields", "line": 135},
        {"name": "createFieldCaps", "line": 228},
        {"name": "it", "line": 127},
        {"name": "describe", "line": 88},
        {"name": "beforeEach", "line": 71}
      ],
      "variable.name": [
        {"name": "result", "line": 135},
        {"name": "metricFields", "line": 193},
        {"name": "testCases", "line": 101},
        {"name": "NO_DATA_INDEX", "line": 33},
        {"name": "TEST_HOST_FIELD", "line": 34},
        {"name": "TEST_HOST_VALUE", "line": 35},
        {"name": "TEST_INDEX", "line": 32},
        {"name": "TEST_METRIC_NAME", "line": 31},
        {"name": "dataStreamFieldCapsMap", "line": 29},
        {"name": "esClientMock", "line": 24},
        {"name": "extractDimensionsMock", "line": 22},
        {"name": "logger", "line": 28},
        {"name": "msearchMock", "line": 23},
        {"name": "normalizeUnitMock", "line": 25}
      ],
      "class.instantiation": [
        {"name": "Map", "line": 81}
      ]
    },
    "imports": {
      "file": [
        {
          "path": ".repos/kibana/src/platform/plugins/shared/metrics_experience/common/types",
          "symbols": ["MetricField"]
        },
        {
          "path": ".repos/kibana/src/platform/plugins/shared/metrics_experience/server/types",
          "symbols": ["DataStreamFieldCapsMap"]
        },
        {
          "path": ".repos/kibana/src/platform/plugins/shared/metrics_experience/server/lib/dimensions/extract_dimensions",
          "symbols": ["extractDimensions"]
        },
        {
          "path": ".repos/kibana/src/platform/plugins/shared/metrics_experience/server/lib/fields/enrich_metric_fields",
          "symbols": ["enrichMetricFields"]
        },
        {
          "path": ".repos/kibana/src/platform/plugins/shared/metrics_experience/server/lib/fields/normalize_unit",
          "symbols": ["normalizeUnit"]
        }
      ],
      "module": [
        {
          "path": "@elastic/elasticsearch/lib/api/types",
          "symbols": ["FieldCapsFieldCapability"]
        }
      ]
    }
  }
}
```
