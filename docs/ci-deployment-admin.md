# CI MCP server — operator notes

Implementation and decision log for the `scsi-mcp-ci` deployment on `oblt-apps`.
For usage, see [ci-deployment.md](ci-deployment.md).

## Infrastructure

The deployment lives in the `oblt-apps` GKE cluster managed by
`environments/users/robots/oblt-apps/config-cluster.yml` in
`elastic/observability-test-environments`.

- **Helm chart**: `semantic-code-search-mcp-server` v0.4.0
- **Image**: `pr-63@sha256:6841b3e7...` (pinned — see [image pinning](#image-pinning))
- **Replicas**: 3 (chart default)
- **Endpoint**: `https://semantic-code-search-ci.elastic.dev/mcp`
- **ES credentials**: reuses `oblt-clusters_scsi_cluster-state` from GCP Secret Manager (same index as the OAuth deployment)

## Authentication

Envoy Gateway's `SecurityPolicy` with `basicAuth` validates the
`Authorization: Basic` header before the request reaches the pod. The pod itself
runs with `MCP_OAUTH_ENABLED=false`.

The htpasswd secret (`scsi-ci:{SHA}<hash>`) lives in GCP Secret Manager as
`oblt-clusters_scsi-ci_basic-auth`, stored as JSON `{".htpasswd": "..."}` so
that the `k8s.secrets` mechanism with `format: json` maps it directly to the
`.htpasswd` key in a K8s `Opaque` Secret.

The plaintext password is in `oblt-clusters_scsi-ci_password` for consumers.

Both secrets are in the `elastic-observability` GCP project and carry labels:
`cluster_name=oblt-apps`, `division=engineering`, `org=obs`,
`project=oblt-clusters`, `team=eng-productivity`.

## Routing

A dedicated hostname (`semantic-code-search-ci.elastic.dev`) was chosen over a
path-based approach (`/ci` on the existing hostname). The reason: MCP clients
do RFC 9728 OAuth discovery at the origin before connecting, and the existing
hostname serves the OAuth server's metadata (`resource: .../mcp`), which
creates a URL mismatch for any `/ci/mcp` URL. A separate hostname avoids
the conflict entirely.

The `gateway-hub-scsi-ci` Helm release creates:
- `HTTPRoute` on `semantic-code-search-ci.elastic.dev` → `scsi-mcp-ci` pod port 3000
- `SecurityPolicy` with `basicAuth` referencing the `scsi-mcp-ci-htpasswd` K8s Secret

## Health probes

The chart defaults hit `/.well-known/oauth-protected-resource`, which only
exists when `MCP_OAUTH_ENABLED=true`. The `scsi-mcp-ci` release overrides
both `startupProbe` and `readinessProbe` to `tcpSocket` on port 3000, with
`httpGet: null` to evict the default from the Helm merge.

## Image pinning

The chart's default `latest` image (SHA `492a53f6...`, built March 2026) uses
stateful session management — it rejects the MCP `initialize` request with
`Bad Request: No valid session ID provided` because it looks up an incoming
`mcp-session-id` header in an in-memory map that doesn't exist yet.

The `pr-63` image contains the stateless refactor (`sessionIdGenerator: undefined`),
which creates a fresh transport per POST request and needs no session tracking.
Until a new `latest` is published from `main`, the image is pinned to `pr-63`.

When `main` gets a new release that includes commit `f08c3f0` (chore: stateless
http) or later, the pin can be removed.

## Envoy Gateway version note

`apiKeyAuth` (`X-Api-Key` header) would have been a cleaner auth method but
requires Envoy Gateway v1.8.0. The `oblt-apps` cluster runs v1.4.0 via the
`gateway-api` chart in `oblt-framework`. `basicAuth` is the next best option
and is fully supported at v1.4.0.

## Rotating credentials

1. Generate a new password and SHA htpasswd entry:
   ```bash
   PASSWORD=$(openssl rand -base64 24)
   htpasswd -nbs scsi-ci "$PASSWORD"
   ```
2. Update `oblt-clusters_scsi-ci_basic-auth` in GCP Secret Manager (new version,
   JSON format: `{".htpasswd": "scsi-ci:{SHA}..."}`).
3. Update `oblt-clusters_scsi-ci_password` with the new plaintext.
4. The `k8s.secrets` sync will pick up the new version within 15 minutes
   (ExternalSecret refresh interval). No pod restart needed.
5. Update the `SCSI_CI_PASSWORD` secret in any CI systems consuming it.
