/**
 * Upstream OIDC client discovery and configuration caching.
 *
 * Our OAuth server delegates user authentication to an external OIDC provider; this module performs
 * discovery and caches the resulting client configuration so `/oauth/authorize` and `/oauth/callback`
 * can drive the upstream login flow.
 */
import type { OAuthConfig } from '../config';
import type { Configuration } from 'openid-client';

export type OidcClientBundle = {
  config: Configuration;
  redirectUri: string;
};

let cached: { issuer: string; bundle: OidcClientBundle } | null = null;

export const getOidcClient = async (cfg: OAuthConfig): Promise<OidcClientBundle> => {
  if (cached && cached.issuer === cfg.oidcIssuer) return cached.bundle;

  const redirectUri = `${cfg.oauthServerUrl}/oauth/callback`;
  // openid-client v6: functional API, discovery returns a Configuration object.
  const oidc = (await import('openid-client')) as typeof import('openid-client');
  const config = await oidc.discovery(new URL(cfg.oidcIssuer), cfg.oidcClientId, cfg.oidcClientSecret);

  const bundle = { config, redirectUri };
  cached = { issuer: cfg.oidcIssuer, bundle };
  return bundle;
};
