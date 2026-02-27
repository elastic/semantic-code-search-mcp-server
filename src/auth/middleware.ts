/**
 * Bearer-token auth middleware for protecting the MCP endpoint.
 *
 * Validates access tokens minted by our `/oauth/token` endpoint and attaches claims onto the request
 * so MCP handlers/tools can enforce authorization and required OIDC claims.
 */
import type { NextFunction, Request, Response } from 'express';

import type { OAuthConfig } from '../config';
import { runWithAuthClaims } from './request_context';
import { verifyAccessToken } from './tokens';

const wwwAuthenticate = (cfg: OAuthConfig, extras?: Record<string, string>) => {
  const params: Record<string, string> = {
    // Point clients at MCP-specific Protected Resource Metadata.
    resource_metadata: `${cfg.oauthServerUrl}/.well-known/oauth-protected-resource/mcp`,
    ...(extras ?? {}),
  };
  const parts = Object.entries(params).map(([k, v]) => `${k}="${v.replace(/"/g, '')}"`);
  return `Bearer ${parts.join(', ')}`;
};

export const bearerAuth = (cfg: OAuthConfig) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      res.setHeader('WWW-Authenticate', wwwAuthenticate(cfg));
      res.status(401).send('Unauthorized');
      return;
    }

    const token = header.slice('bearer '.length).trim();
    try {
      const claims = await verifyAccessToken({
        token,
        signingSecret: cfg.jwtSigningSecret,
        issuer: cfg.oauthServerUrl,
        audience: cfg.oauthServerUrl,
      });

      for (const claim of cfg.oidcRequiredClaims) {
        if ((claims as unknown as Record<string, unknown>)[claim] == null) {
          res.status(403).send('Forbidden');
          return;
        }
      }

      req.mcpAuth = { claims };

      if (cfg.debugEnabled) {
        const now = Math.floor(Date.now() / 1000);
        const exp = typeof claims.exp === 'number' ? claims.exp : undefined;
        const remaining = exp ? Math.max(0, exp - now) : null;
        // Safe, derived logging only: never log raw tokens or headers.
        console.log(`[oauth-debug] path=${req.path} sub=${claims.sub} scope=${claims.scope} expires_in=${remaining}`);
      }

      return runWithAuthClaims(claims, () => next());
    } catch {
      res.setHeader('WWW-Authenticate', wwwAuthenticate(cfg, { error: 'invalid_token' }));
      res.status(401).send('Unauthorized');
    }
  };
};
