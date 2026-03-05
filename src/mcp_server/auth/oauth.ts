import express from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  mcpAuthMetadataRouter,
  getOAuthProtectedResourceMetadataUrl,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { oauthConfig } from '../../config';

type OAuthConfig = typeof oauthConfig;

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  introspection_endpoint?: string;
  response_types_supported: string[];
  [key: string]: unknown;
}

export async function discoverOidcEndpoints(issuer: string): Promise<OidcDiscovery> {
  const issuerUrl = issuer.replace(/\/$/, '');
  const candidates = [
    `${issuerUrl}/.well-known/openid-configuration`,
    `${issuerUrl}/.well-known/oauth-authorization-server`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const doc = (await res.json()) as OidcDiscovery;
        if (doc.issuer && doc.authorization_endpoint && doc.token_endpoint && doc.jwks_uri) {
          return doc;
        }
      }
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    `OAuth discovery failed: could not retrieve a valid OIDC configuration document from issuer "${issuer}". ` +
      `Tried: ${candidates.join(', ')}`
  );
}

export function buildIntrospectionVerifier(
  introspectionEndpoint: string,
  clientId: string,
  clientSecret: string,
  serverUrl: URL,
  allowedClientIds: string[] = []
): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const params = new URLSearchParams({ token, client_id: clientId });
      if (clientSecret) {
        params.set('client_secret', clientSecret);
      }

      const res = await fetch(introspectionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!res.ok) {
        const msg = `Token introspection failed with status ${res.status}`;
        console.error(`[oauth] ${msg}`);
        throw new InvalidTokenError(msg);
      }

      const data = (await res.json()) as {
        active: boolean;
        client_id?: string;
        scope?: string;
        exp?: number;
        aud?: string | string[];
      };

      if (!data.active) {
        throw new InvalidTokenError('Token is not active');
      }

      const tokenClientId = data.client_id ?? clientId;
      if (allowedClientIds.length > 0 && !allowedClientIds.includes(tokenClientId)) {
        console.error(`[oauth] Rejected token: client_id "${tokenClientId}" is not in the allowlist`);
        throw new InvalidTokenError('Token client not authorized');
      }

      const audiences: string[] = Array.isArray(data.aud) ? data.aud : data.aud ? [data.aud] : [];

      if (audiences.length > 0) {
        const allowed = audiences.some((aud) =>
          checkResourceAllowed({ requestedResource: aud, configuredResource: serverUrl })
        );
        if (!allowed) {
          throw new InvalidTokenError('Token audience mismatch');
        }
      }

      return {
        token,
        clientId: tokenClientId,
        scopes: data.scope ? data.scope.split(' ').filter(Boolean) : [],
        expiresAt: data.exp,
      };
    },
  };
}

export function buildJwksVerifier(
  jwksUri: string,
  issuer: string,
  serverUrl: URL,
  explicitAudience?: string,
  allowedClientIds: string[] = []
): OAuthTokenVerifier {
  const jwks = createRemoteJWKSet(new URL(jwksUri));

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
      try {
        // Do not pass `audience` to jwtVerify — Okta (and MCP-compliant clients) set
        // `aud` to the resource server URL (MCP_SERVER_URL), not the issuer URL.
        // We validate the audience claim manually below using checkResourceAllowed.
        ({ payload } = await jwtVerify(token, jwks, {
          issuer,
          algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
        }));
      } catch (err) {
        if (err instanceof InvalidTokenError) throw err;
        // Convert jose errors (JWTExpired, JWSSignatureVerificationFailed, etc.) to
        // InvalidTokenError so the bearer-auth middleware returns 401, not 500.
        const message = err instanceof Error ? err.message : 'Token verification failed';
        console.error(`[oauth] JWT verification failed: ${message}`);
        throw new InvalidTokenError(message);
      }

      const rawAud = payload.aud;
      const audiences: string[] = Array.isArray(rawAud) ? rawAud : rawAud ? [rawAud] : [];

      if (audiences.length === 0) {
        throw new InvalidTokenError('Token is missing the "aud" claim');
      }

      const configuredAudience = explicitAudience ?? serverUrl.href;
      const allowed = audiences.some((aud) => {
        try {
          return checkResourceAllowed({ requestedResource: aud, configuredResource: configuredAudience });
        } catch {
          return aud === configuredAudience;
        }
      });
      if (!allowed) {
        throw new InvalidTokenError('Token audience mismatch');
      }

      // `scope` (space-separated string) is standard; `scp` (string array) is Okta-specific.
      const scopes = Array.isArray(payload.scp)
        ? (payload.scp as string[])
        : typeof payload.scope === 'string'
          ? payload.scope.split(' ').filter(Boolean)
          : [];

      // Priority: client_id (standard) → azp (standard authorized-party) → cid (Okta-specific)
      const clientId =
        [payload.client_id, payload.azp, payload.cid].find((v): v is string => typeof v === 'string') ?? '';

      if (allowedClientIds.length > 0 && !allowedClientIds.includes(clientId)) {
        console.error(`[oauth] Rejected token: client_id "${clientId}" is not in the allowlist`);
        throw new InvalidTokenError('Token client not authorized');
      }

      return {
        token,
        clientId,
        scopes,
        expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
      };
    },
  };
}

export async function setupOAuth(app: express.Application, config: OAuthConfig, serverUrl: string): Promise<void> {
  const issuer = config.issuer!;
  const serverUrlObj = new URL(serverUrl);

  const discovery = await discoverOidcEndpoints(issuer);

  const useIntrospection = Boolean(config.clientId && config.clientSecret);

  let verifier: OAuthTokenVerifier;
  if (useIntrospection) {
    if (!discovery.introspection_endpoint) {
      throw new Error(
        `MCP_OAUTH_CLIENT_ID and MCP_OAUTH_CLIENT_SECRET are set but the OIDC provider at "${issuer}" ` +
          `does not expose an introspection_endpoint in its discovery document. ` +
          `Either configure your provider to expose introspection, or remove the client credentials to use JWKS validation instead.`
      );
    }
    console.error(`[oauth] Using token introspection endpoint: ${discovery.introspection_endpoint}`);
    verifier = buildIntrospectionVerifier(
      discovery.introspection_endpoint,
      config.clientId!,
      config.clientSecret!,
      serverUrlObj,
      config.allowedClientIds
    );
  } else {
    console.error(`[oauth] Using JWKS validation. JWKS URI: ${discovery.jwks_uri}`);
    verifier = buildJwksVerifier(
      discovery.jwks_uri,
      discovery.issuer,
      serverUrlObj,
      config.audience,
      config.allowedClientIds
    );
  }

  const oauthMetadata: OAuthMetadata = {
    issuer: discovery.issuer,
    authorization_endpoint: discovery.authorization_endpoint,
    token_endpoint: discovery.token_endpoint,
    response_types_supported: discovery.response_types_supported ?? ['code'],
    ...(discovery.introspection_endpoint && {
      introspection_endpoint: discovery.introspection_endpoint,
    }),
  };

  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: serverUrlObj,
      scopesSupported: config.requiredScopes.length > 0 ? config.requiredScopes : undefined,
      resourceName: 'Semantic Code Search MCP Server',
    })
  );

  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(serverUrlObj);
  const authMiddleware = requireBearerAuth({
    verifier,
    requiredScopes: config.requiredScopes.length > 0 ? config.requiredScopes : [],
    resourceMetadataUrl,
  });

  app.use('/mcp', authMiddleware);
}
