# Using the CI MCP server

`https://semantic-code-search-ci.elastic.dev/mcp` is a second instance of the Semantic Code Search MCP server that uses HTTP Basic Auth instead of OIDC. Same index, same tools — just no browser required, so it works from pipelines and scripts.

## Authentication

Envoy Gateway checks the `Authorization: Basic` header before the request reaches the app. Credentials:

- **Username**: `scsi-ci`
- **Password**: GCP Secret Manager, project `elastic-observability`, secret `oblt-clusters_scsi-ci_password`

```bash
gcloud secrets versions access latest \
  --secret=oblt-clusters_scsi-ci_password \
  --project=elastic-observability
```

You need read access to the `elastic-observability` GCP project. If you don't have it, ask in `#observablt-bots`.

## Setting it up locally

**Claude Code CLI:**

```bash
export SCSI_CI_PASSWORD=$(gcloud secrets versions access latest \
  --secret=oblt-clusters_scsi-ci_password \
  --project=elastic-observability)

claude mcp add semantic-code-search-ci \
  https://semantic-code-search-ci.elastic.dev/mcp \
  --transport http \
  --header "Authorization: Basic $(echo -n "scsi-ci:${SCSI_CI_PASSWORD}" | base64)"
```

**VS Code (`settings.json`):**

```json
{
  "claude.mcpServers": {
    "semantic-code-search-ci": {
      "type": "http",
      "url": "https://semantic-code-search-ci.elastic.dev/mcp",
      "headers": {
        "Authorization": "Basic <base64(scsi-ci:<password>)>"
      }
    }
  }
}
```

## Using it in CI

Store the password as a secret in your CI system and build the `Authorization` header at runtime. The Claude Code CLI runs non-interactively with the `-p` flag:

**GitHub Actions example:**

```yaml
- name: Run semantic code search
  env:
    SCSI_CI_PASSWORD: ${{ secrets.SCSI_CI_PASSWORD }}
  run: |
    export B64=$(echo -n "scsi-ci:${SCSI_CI_PASSWORD}" | base64)
    claude mcp add semantic-code-search-ci \
      https://semantic-code-search-ci.elastic.dev/mcp \
      --transport http \
      --header "Authorization: Basic ${B64}"
    claude -p "search for implementations of X" --allowedTools semantic-code-search-ci
```

The plain-text password lives in GCP Secret Manager under `oblt-clusters_scsi-ci_password` in the `elastic-observability` project — store it as a repository or org secret before running this.

## What's different from the OAuth deployment

`semantic-code-search.elastic.dev` requires an OIDC token from Okta, which means a browser. This one doesn't. Same index, same tools, different auth layer.

## Dependencies

- Read access to the `elastic-observability` GCP project
- `oblt-clusters_scsi-ci_password` secret in GCP Secret Manager
- For CI: the password in your pipeline's secrets store
