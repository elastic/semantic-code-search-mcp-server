import dotenv from 'dotenv';
dotenv.config({ quiet: true });

export const elasticsearchConfig = {
  endpoint: process.env.ELASTICSEARCH_ENDPOINT,
  cloudId: process.env.ELASTICSEARCH_CLOUD_ID,
  username: process.env.ELASTICSEARCH_USER,
  password: process.env.ELASTICSEARCH_PASSWORD,
  apiKey: process.env.ELASTICSEARCH_API_KEY,
  index: process.env.ELASTICSEARCH_INDEX || 'semantic-code-search',
};

export const oauthConfig = {
  enabled: process.env.SCS_MCP_OAUTH_ENABLED === 'true',
  issuer: process.env.SCS_MCP_OAUTH_ISSUER,
  clientId: process.env.SCS_MCP_OAUTH_CLIENT_ID,
  clientSecret: process.env.SCS_MCP_OAUTH_CLIENT_SECRET,
  // Optional: override the expected `aud` claim. Needed for OIDC providers (e.g. Okta)
  // that use a fixed audience (e.g. "api://default") instead of the resource URL.
  audience: process.env.SCS_MCP_OAUTH_AUDIENCE,
  requiredScopes: process.env.SCS_MCP_OAUTH_REQUIRED_SCOPES
    ? process.env.SCS_MCP_OAUTH_REQUIRED_SCOPES.split(' ').filter(Boolean)
    : [],
  // Optional: restrict which OAuth client IDs are allowed to access this server.
  // Space-separated list. If empty, any client from the configured issuer is accepted.
  // Set to your Okta app's client ID to prevent tokens from other apps in the same
  // tenant from being accepted.
  allowedClientIds: process.env.SCS_MCP_OAUTH_ALLOWED_CLIENT_IDS
    ? process.env.SCS_MCP_OAUTH_ALLOWED_CLIENT_IDS.split(' ').filter(Boolean)
    : [],
  serverUrl: process.env.SCS_MCP_SERVER_URL,
};
