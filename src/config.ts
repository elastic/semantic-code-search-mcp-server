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

const isTruthy = (value: string | undefined) => {
  if (!value) return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.toLowerCase());
};

const requireEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

export const oauthEnabled = isTruthy(process.env.OIDC_AUTH_ENABLED);
export const oauthDebugEnabled = isTruthy(process.env.OAUTH_DEBUG_ENABLED);

export type OAuthConfig = {
  oauthServerUrl: string;
  jwtSigningSecret: string;
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret: string;
  oidcCookieSecret: string;
  oidcRequiredClaims: string[];
  oauthStorage: 'memory' | 'redis';
  redisUrl?: string;
  debugEnabled: boolean;
};

export const loadOauthConfig = (): OAuthConfig | null => {
  if (!oauthEnabled) return null;

  const oauthStorage = (process.env.OAUTH_STORAGE || 'memory') as OAuthConfig['oauthStorage'];
  if (oauthStorage !== 'memory' && oauthStorage !== 'redis') {
    throw new Error(`Invalid OAUTH_STORAGE: ${oauthStorage}. Expected "memory" or "redis".`);
  }

  const cfg: OAuthConfig = {
    oauthServerUrl: requireEnv('OAUTH_SERVER_URL').replace(/\/+$/, ''),
    jwtSigningSecret: requireEnv('JWT_SIGNING_SECRET'),
    oidcIssuer: requireEnv('OIDC_ISSUER'),
    oidcClientId: requireEnv('OIDC_CLIENT_ID'),
    oidcClientSecret: requireEnv('OIDC_CLIENT_SECRET'),
    oidcCookieSecret: requireEnv('OIDC_COOKIE_SECRET'),
    oidcRequiredClaims: (process.env.OIDC_REQUIRED_CLAIMS || 'sub')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    oauthStorage,
    redisUrl: process.env.REDIS_URL,
    debugEnabled: oauthDebugEnabled,
  };

  if (cfg.oauthStorage === 'redis' && !cfg.redisUrl) {
    throw new Error('OAUTH_STORAGE=redis requires REDIS_URL to be set.');
  }

  return cfg;
};
