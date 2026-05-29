# Using the CI MCP server

`https://semantic-code-search-ci.elastic.dev/mcp` is a deployment of the Semantic Code Search MCP server for pipelines and automated tooling. It uses HTTP Basic Auth, so no browser login is needed.

## Get the password

The password is in GCP Secret Manager:

```bash
gcloud secrets versions access latest \
  --secret=oblt-clusters_scsi-ci_password \
  --project=elastic-observability
```

You need read access to the `elastic-observability` GCP project. If you don't have it, ask in `#observablt-bots`.

## Claude Code CLI

```bash
export SCSI_CI_PASSWORD=$(gcloud secrets versions access latest \
  --secret=oblt-clusters_scsi-ci_password \
  --project=elastic-observability)

claude mcp add semantic-code-search-ci \
  https://semantic-code-search-ci.elastic.dev/mcp \
  --transport http \
  --header "Authorization: Basic $(echo -n "scsi-ci:${SCSI_CI_PASSWORD}" | base64)"
```

## VS Code

Add to `settings.json`:

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

## GitHub Actions

Store `SCSI_CI_PASSWORD` as a repository or org secret, then:

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

## vs. the main deployment

The main instance at `semantic-code-search.elastic.dev` requires an Okta login. Use this one when you can't do a browser flow.
