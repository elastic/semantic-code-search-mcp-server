/**
 * Dynamic Client Registration (DCR) endpoint.
 *
 * Allows MCP clients (like Cursor) to register `client_id` + redirect URIs at runtime so they can
 * initiate the OAuth authorization code flow against `/oauth/authorize`.
 */
import { randomUUID } from 'crypto';
import type { Request, Response, Router } from 'express';

import type { OAuthConfig } from '../../config';
import type { OAuthStorage, OAuthClientMetadata } from '../storage';

type DcrRequest = {
  client_name?: string;
  client_uri?: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  scope?: string;
};

const isLocalhostRedirect = (uri: string) => {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    if (u.protocol !== 'http:') return false;
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  } catch {
    return false;
  }
};

const isCursorRedirect = (uri: string) => {
  try {
    const u = new URL(uri);
    // Cursor uses a custom URI scheme for OAuth callbacks.
    return u.protocol === 'cursor:';
  } catch {
    return false;
  }
};

const setNoCORS = (res: Response) => {
  // Intentional: don't reflect Origin on OAuth endpoints.
  res.removeHeader('Access-Control-Allow-Origin');
};

export const registerDcrRoutes = (router: Router, _cfg: OAuthConfig, storage: OAuthStorage) => {
  router.post('/oauth/register', async (req: Request, res: Response) => {
    setNoCORS(res);
    const body = req.body as Partial<DcrRequest> | undefined;

    if (!body || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
      res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris is required' });
      return;
    }

    const redirectUris = body.redirect_uris.filter((u) => typeof u === 'string');
    if (redirectUris.length !== body.redirect_uris.length) {
      res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris must be strings' });
      return;
    }

    for (const uri of redirectUris) {
      if (!isLocalhostRedirect(uri) && !isCursorRedirect(uri)) {
        res.status(400).json({
          error: 'invalid_redirect_uri',
          error_description: `redirect_uri must be https, http://localhost, or cursor://: ${uri}`,
        });
        return;
      }
    }

    const tokenEndpointAuthMethod = (body.token_endpoint_auth_method ?? 'none') as string;
    if (tokenEndpointAuthMethod !== 'none') {
      res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'Only token_endpoint_auth_method="none" is supported',
      });
      return;
    }

    const grantTypes = body.grant_types ?? ['authorization_code', 'refresh_token'];
    const responseTypes = body.response_types ?? ['code'];

    if (!grantTypes.includes('authorization_code') || !responseTypes.includes('code')) {
      res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'grant_types must include authorization_code and response_types must include code',
      });
      return;
    }

    const clientId = randomUUID();
    const createdAtMs = Date.now();

    const metadata: OAuthClientMetadata = {
      clientId,
      clientName: body.client_name,
      clientUri: body.client_uri,
      redirectUris,
      grantTypes,
      responseTypes,
      tokenEndpointAuthMethod: 'none',
      scope: body.scope,
      createdAtMs,
    };

    await storage.createClient(metadata);

    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: Math.floor(createdAtMs / 1000),
      token_endpoint_auth_method: 'none',
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes,
      client_name: body.client_name,
      client_uri: body.client_uri,
      scope: body.scope,
    });
  });
};
