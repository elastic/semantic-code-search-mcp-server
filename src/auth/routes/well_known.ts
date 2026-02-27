/**
 * OAuth metadata endpoints ("well-known").
 *
 * Serves protected resource metadata and authorization server metadata so MCP clients can discover
 * where to register, authorize, and exchange tokens.
 */
import type { Request, Response, Router } from 'express';

import type { OAuthConfig } from '../../config';

const setPublicCors = (res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

export const registerWellKnownRoutes = (router: Router, cfg: OAuthConfig) => {
  const baseResource = cfg.oauthServerUrl;
  const mcpResource = `${cfg.oauthServerUrl}/mcp`;

  router.options('/.well-known/oauth-protected-resource', (_req, res) => {
    setPublicCors(res);
    res.status(204).end();
  });

  router.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
    setPublicCors(res);
    res.json({
      resource: baseResource,
      authorization_servers: [cfg.oauthServerUrl],
      scopes_supported: ['mcp:read'],
      bearer_methods_supported: ['header'],
    });
  });

  router.options('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
    setPublicCors(res);
    res.status(204).end();
  });

  router.get('/.well-known/oauth-protected-resource/mcp', (_req: Request, res: Response) => {
    setPublicCors(res);
    res.json({
      resource: mcpResource,
      authorization_servers: [cfg.oauthServerUrl],
      scopes_supported: ['mcp:read'],
      bearer_methods_supported: ['header'],
    });
  });

  router.options('/.well-known/oauth-authorization-server', (_req, res) => {
    setPublicCors(res);
    res.status(204).end();
  });

  router.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
    setPublicCors(res);
    res.json({
      issuer: cfg.oauthServerUrl,
      authorization_endpoint: `${cfg.oauthServerUrl}/oauth/authorize`,
      token_endpoint: `${cfg.oauthServerUrl}/oauth/token`,
      registration_endpoint: `${cfg.oauthServerUrl}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp:read'],
      code_challenge_methods_supported: ['S256'],
    });
  });
};
