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

/**
 * Parse comma-separated list of required claims
 */
function parseRequiredClaims(value: string | undefined): string[] {
  if (!value) return ['sub'];
  return value
    .split(',')
    .map((claim) => claim.trim())
    .filter(Boolean);
}

export const oidcConfig = {
  enabled: process.env.OIDC_AUTH_ENABLED === 'true',
  issuer: process.env.OIDC_ISSUER,
  audience: process.env.OIDC_AUDIENCE,
  clientId: process.env.OIDC_CLIENT_ID,
  clientSecret: process.env.OIDC_CLIENT_SECRET,
  redirectUri: process.env.OIDC_REDIRECT_URI,
  cookieSecret: process.env.OIDC_COOKIE_SECRET,
  requiredClaims: parseRequiredClaims(process.env.OIDC_REQUIRED_CLAIMS),
};
