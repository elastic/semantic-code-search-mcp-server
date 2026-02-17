import * as jose from 'jose';
import { oidcConfig } from '../config';

export interface TokenClaims {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  [key: string]: unknown;
}

interface OIDCDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
  introspection_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
}

// Cache for OIDC discovery and JWKS
let discoveryCache: OIDCDiscovery | null = null;
let jwksCache: jose.JWTVerifyGetKey | null = null;

/**
 * Fetch OIDC discovery document from the issuer.
 */
export async function getOIDCDiscovery(): Promise<OIDCDiscovery> {
  if (discoveryCache) {
    return discoveryCache;
  }

  const issuer = oidcConfig.issuer;
  if (!issuer) {
    throw new Error('OIDC_ISSUER not configured');
  }

  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;

  const response = await fetch(discoveryUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch OIDC discovery: ${response.status}`);
  }

  discoveryCache = (await response.json()) as OIDCDiscovery;

  return discoveryCache;
}

/**
 * Get the JWKS key set for verifying tokens.
 */
async function getJWKS(): Promise<jose.JWTVerifyGetKey> {
  if (jwksCache) {
    return jwksCache;
  }

  const discovery = await getOIDCDiscovery();
  jwksCache = jose.createRemoteJWKSet(new URL(discovery.jwks_uri));
  return jwksCache;
}

/**
 * Validate a JWT access token and return the claims.
 *
 * @param token The JWT token to validate
 * @returns The token claims if valid
 * @throws Error if token is invalid, expired, or missing required claims
 */
export async function validateAccessToken(token: string): Promise<TokenClaims> {
  const issuer = oidcConfig.issuer;
  if (!issuer) {
    throw new Error('OIDC_ISSUER not configured');
  }

  const jwks = await getJWKS();

  try {
    const verifyOptions: jose.JWTVerifyOptions = {
      issuer,
    };

    // Add audience validation if configured
    if (oidcConfig.audience) {
      verifyOptions.audience = oidcConfig.audience;
    }

    const { payload } = await jose.jwtVerify(token, jwks, verifyOptions);

    // Some providers (notably Okta) may omit identity claims like `email` from access tokens.
    // If required claims are missing, attempt to enrich via the userinfo endpoint.
    const mergedClaims: TokenClaims = { ...(payload as TokenClaims) };
    const missingBefore = oidcConfig.requiredClaims.filter((claim) => !mergedClaims[claim]);

    if (missingBefore.length > 0) {
      try {
        const userInfo = await getUserInfo(token);
        Object.assign(mergedClaims, userInfo);
      } catch {
        // ignore; we'll fail below if required claims are still missing
      }
    }

    // Validate required claims (after optional userinfo enrichment)
    for (const claim of oidcConfig.requiredClaims) {
      if (!mergedClaims[claim]) {
        throw new Error(`Token missing required claim: ${claim}`);
      }
    }

    return mergedClaims;
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      throw new Error('Token expired');
    }
    if (error instanceof jose.errors.JWTClaimValidationFailed) {
      throw new Error(`Token validation failed: ${error.claim}`);
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Token validation failed');
  }
}

/**
 * Generate a PKCE code verifier and challenge.
 */
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = jose.base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
  const challengeBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = jose.base64url.encode(new Uint8Array(challengeBuffer));
  return { verifier, challenge };
}

/**
 * Generate the authorization URL for OAuth login.
 */
export async function getAuthorizationUrl(
  state: string,
  codeChallenge: string,
  redirectUri: string,
  nonce: string
): Promise<string> {
  const discovery = await getOIDCDiscovery();
  const clientId = oidcConfig.clientId;

  if (!clientId) {
    throw new Error('OIDC_CLIENT_ID not configured');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    nonce,
  });

  return `${discovery.authorization_endpoint}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<{ access_token: string; id_token?: string; expires_in: number }> {
  const discovery = await getOIDCDiscovery();
  const clientId = oidcConfig.clientId;
  const clientSecret = oidcConfig.clientSecret;

  if (!clientId) {
    throw new Error('OIDC_CLIENT_ID not configured');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: clientId,
  });

  // Add client secret if configured (confidential client)
  if (clientSecret) {
    body.set('client_secret', clientSecret);
  }

  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * Fetch user info from the userinfo endpoint.
 */
export async function getUserInfo(accessToken: string): Promise<TokenClaims> {
  const discovery = await getOIDCDiscovery();

  if (!discovery.userinfo_endpoint) {
    throw new Error('OIDC provider does not support userinfo endpoint');
  }

  const response = await fetch(discovery.userinfo_endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.status}`);
  }

  return await response.json();
}

/**
 * Validate an ID token and optionally check the nonce claim.
 */
export async function validateIdToken(idToken: string, expectedNonce?: string): Promise<TokenClaims> {
  const issuer = oidcConfig.issuer;
  const clientId = oidcConfig.clientId;

  if (!issuer) {
    throw new Error('OIDC_ISSUER not configured');
  }

  const jwks = await getJWKS();

  try {
    const { payload } = await jose.jwtVerify(idToken, jwks, {
      issuer,
      audience: clientId,
    });

    // Validate nonce if provided
    if (expectedNonce) {
      const tokenNonce = payload.nonce as string | undefined;
      if (!tokenNonce) {
        throw new Error('ID token missing nonce claim');
      }
      if (tokenNonce !== expectedNonce) {
        throw new Error('ID token nonce mismatch');
      }
    }

    return payload as TokenClaims;
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      throw new Error('ID token expired');
    }
    if (error instanceof jose.errors.JWTClaimValidationFailed) {
      throw new Error(`ID token validation failed: ${error.claim}`);
    }
    throw error;
  }
}

/**
 * Validate an opaque access token using token introspection
 * Falls back to Google's tokeninfo endpoint
 */
export async function introspectAccessToken(token: string): Promise<TokenClaims> {
  const issuer = oidcConfig.issuer;

  const discovery = await getOIDCDiscovery();
  const providerIntrospection = (discovery as OIDCDiscovery & { introspection_endpoint?: string })
    .introspection_endpoint;
  const googleTokenInfoUrl = `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`;

  try {
    // Prefer provider's RFC7662 introspection endpoint when available (e.g. Okta).
    if (providerIntrospection) {
      const body = new URLSearchParams({
        token,
        token_type_hint: 'access_token',
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };

      const clientId = oidcConfig.clientId;
      const clientSecret = oidcConfig.clientSecret;
      if (clientId && clientSecret) {
        headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
      } else if (clientId) {
        body.set('client_id', clientId);
      }

      const response = await fetch(providerIntrospection, {
        method: 'POST',
        headers,
        body: body.toString(),
      });

      if (!response.ok) {
        throw new Error(`Token introspection failed: ${response.status}`);
      }

      const data = (await response.json()) as {
        active?: boolean;
        sub?: string;
        username?: string;
        scope?: string;
        exp?: number;
        email?: string;
        [k: string]: unknown;
      };

      if (!data.active) {
        throw new Error('Token inactive');
      }

      const claims: TokenClaims = {
        sub: (data.sub as string) || (data.username as string) || 'unknown',
      };

      if (typeof data.email === 'string') {
        claims.email = data.email;
      }

      // Enrich from userinfo if needed (common: email not present in introspection response)
      const missing = oidcConfig.requiredClaims.filter((claim) => !claims[claim]);
      if (missing.length > 0) {
        try {
          const userInfo = await getUserInfo(token);
          Object.assign(claims, userInfo);
        } catch {
          // ignore; required claim validation below will fail if still missing
        }
      }

      for (const claim of oidcConfig.requiredClaims) {
        if (!claims[claim]) {
          throw new Error(`Token missing required claim: ${claim}`);
        }
      }

      return claims;
    }

    // Fallback to Google's tokeninfo endpoint when provider introspection isn't available.
    const response = await fetch(googleTokenInfoUrl);

    if (!response.ok) {
      throw new Error(`Token introspection failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      azp?: string;
      aud?: string;
      sub?: string;
      email?: string;
      email_verified?: string;
      expires_in?: number;
      error_description?: string;
    };

    if (data.error_description) {
      throw new Error(data.error_description);
    }

    // Check if token is expired
    if (data.expires_in !== undefined && data.expires_in <= 0) {
      throw new Error('Token expired');
    }

    // Validate issuer if we can determine it
    if (issuer === 'https://accounts.google.com' && !data.azp) {
      throw new Error('Invalid token response');
    }

    const claims: TokenClaims = {
      sub: data.sub || data.azp || 'unknown',
      email: data.email,
      email_verified: data.email_verified === 'true',
    } as TokenClaims;

    for (const claim of oidcConfig.requiredClaims) {
      if (!claims[claim]) {
        throw new Error(`Token missing required claim: ${claim}`);
      }
    }

    return claims;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Token introspection failed');
  }
}

/**
 * Clear the OIDC caches (useful for testing or when config changes).
 */
export function clearOIDCCache(): void {
  discoveryCache = null;
  jwksCache = null;
}
