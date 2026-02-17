import { Router, Request, Response } from 'express';
import { oidcConfig } from '../config';
import { registerClient, getClient, validateClient, isValidRedirectUri } from '../lib/oauth-clients';
import { getAuthorizationUrl, exchangeCodeForTokens } from '../lib/oidc';
import { storeOAuthState, retrieveOAuthState } from '../lib/session';
import { logger } from '../lib/logger';

export const oauthRouter = Router();

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === 'string' ? value : undefined;
}

function getBody(req: Request): Record<string, unknown> | null {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body as Record<string, unknown>;
  }
  return null;
}

function getBodyString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
}

function getBodyStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (!Array.isArray(value)) return undefined;
  if (!value.every((v) => typeof v === 'string')) return undefined;
  return value;
}

/**
 * POST /oauth/register
 * Dynamic Client Registration (RFC 7591)
 * Allows OAuth clients (like Cursor) to register dynamically
 */
oauthRouter.post('/register', async (req: Request, res: Response) => {
  if (!oidcConfig.enabled) {
    res.status(404).json({ error: 'OAuth not enabled' });
    return;
  }

  try {
    const body = getBody(req);
    if (!body) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Request body must be an object',
      });
      return;
    }

    const redirectUris = getBodyStringArray(body, 'redirect_uris');
    const grantTypes = getBodyStringArray(body, 'grant_types');
    const responseTypes = getBodyStringArray(body, 'response_types');

    if (!redirectUris || redirectUris.length === 0) {
      res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uris is required and must be a non-empty array',
      });
      return;
    }

    // Register the client
    const client = registerClient(redirectUris, grantTypes, responseTypes);

    logger.info('OAuth', 'Client registered', {
      client_id: client.client_id,
    });

    // Return client info (RFC 7591 response)
    res.json({
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uris: client.redirect_uris,
      grant_types: client.grant_types || ['authorization_code', 'refresh_token'],
      response_types: client.response_types || ['code'],
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      client_id_issued_at: Math.floor(client.created_at / 1000),
    });
  } catch (error) {
    logger.error('OAuth', 'Client registration failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to register client',
    });
  }
});

/**
 * GET /oauth/authorize
 * OAuth authorization endpoint (proxies to OIDC provider)
 * Handles dynamically registered clients
 */
oauthRouter.get('/authorize', async (req: Request, res: Response) => {
  if (!oidcConfig.enabled) {
    res.status(404).send('OAuth not enabled');
    return;
  }

  try {
    const clientId = getQueryParam(req, 'client_id');
    const redirectUri = getQueryParam(req, 'redirect_uri');
    const state = getQueryParam(req, 'state');
    const codeChallenge = getQueryParam(req, 'code_challenge');
    const codeChallengeMethod = getQueryParam(req, 'code_challenge_method');

    if (!clientId || !redirectUri || !state) {
      res.status(400).send('Missing required parameters');
      return;
    }

    // Require client-supplied PKCE (public clients / DCR)
    if (!codeChallenge || codeChallengeMethod !== 'S256') {
      res.status(400).send('Missing or invalid PKCE parameters');
      return;
    }

    // Check if this is a dynamically registered client
    const client = getClient(clientId);
    if (!client) {
      res.status(400).send('Invalid client_id');
      return;
    }

    // Validate redirect URI
    if (!isValidRedirectUri(clientId, redirectUri)) {
      res.status(400).send('Invalid redirect_uri');
      return;
    }

    const challenge = codeChallenge;
    const nonce = crypto.randomUUID();

    // Store state mapping (client state -> our state -> client metadata)
    const ourState = crypto.randomUUID();
    await storeOAuthState(ourState, {
      clientId,
      redirectUri,
      originalState: state,
    });

    // Redirect to OIDC provider with our configured client
    const providerRedirectUri = oidcConfig.redirectUri || `${req.protocol}://${req.get('host')}/oauth/callback`;
    const authUrl = await getAuthorizationUrl(ourState, challenge, providerRedirectUri, nonce);

    logger.debug('OAuth', 'Authorization request', {
      client_id: clientId,
    });

    res.redirect(authUrl);
  } catch (error) {
    logger.error('OAuth', 'Authorization failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).send('Authorization failed');
  }
});

/**
 * GET /oauth/callback
 * OAuth callback from OIDC provider
 * Redirects back to the dynamically registered client
 */
oauthRouter.get('/callback', async (req: Request, res: Response) => {
  if (!oidcConfig.enabled) {
    res.status(404).send('OAuth not enabled');
    return;
  }

  const code = getQueryParam(req, 'code');
  const state = getQueryParam(req, 'state');
  const error = getQueryParam(req, 'error');

  if (error) {
    logger.error('OAuth', 'Provider returned error', { error });
    res.status(400).send(`OAuth error: ${error}`);
    return;
  }

  if (!code || !state) {
    res.status(400).send('Missing code or state');
    return;
  }

  try {
    const stateData = await retrieveOAuthState(state);

    if (!stateData) {
      res.status(400).send('Invalid or expired state');
      return;
    }

    const clientId = stateData.clientId;
    const originalState = stateData.originalState;
    const clientRedirectUri = stateData.redirectUri;

    logger.debug('OAuth', 'Authorization code received', {
      client_id: clientId,
    });

    // Build the callback URL to the client with the authorization code
    const callbackUrl = new URL(clientRedirectUri);
    callbackUrl.searchParams.set('code', code);
    callbackUrl.searchParams.set('state', originalState);

    // Show success page with auto-redirect to custom protocol
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Successful</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: #f5f5f5;
            }
            .container {
              text-align: center;
              background: white;
              padding: 40px;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 { color: #2e7d32; margin-bottom: 16px; }
            p { color: #666; margin-bottom: 16px; }
            .spinner {
              border: 3px solid #f3f3f3;
              border-top: 3px solid #1976d2;
              border-radius: 50%;
              width: 40px;
              height: 40px;
              animation: spin 1s linear infinite;
              margin: 20px auto;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✓ Authentication Successful</h1>
            <div class="spinner"></div>
            <p>Returning to Cursor...</p>
            <p style="font-size: 12px; color: #999;">You can close this window if it doesn't close automatically</p>
          </div>
          <script>
            // Redirect to Cursor after a short delay
            setTimeout(() => {
              window.location.href = ${JSON.stringify(callbackUrl.toString())};
              // Try to close the window after redirect
              setTimeout(() => window.close(), 500);
            }, 1000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('OAuth', 'Callback processing failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).send('Callback processing failed');
  }
});

/**
 * POST /oauth/token
 * OAuth token endpoint (proxies to OIDC provider)
 * Handles token exchange for dynamically registered clients
 */
oauthRouter.post('/token', async (req: Request, res: Response) => {
  if (!oidcConfig.enabled) {
    res.status(404).json({ error: 'OAuth not enabled' });
    return;
  }

  const body = getBody(req);
  if (!body) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Request body must be an object',
    });
    return;
  }

  const grantType = getBodyString(body, 'grant_type');
  const code = getBodyString(body, 'code');
  const redirectUri = getBodyString(body, 'redirect_uri');
  const clientId = getBodyString(body, 'client_id');
  const clientSecret = getBodyString(body, 'client_secret');
  const codeVerifier = getBodyString(body, 'code_verifier');

  logger.debug('OAuth', 'Token exchange requested', {
    grant_type: grantType,
    client_id: clientId,
  });

  try {
    if (grantType !== 'authorization_code') {
      res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code grant type is supported',
      });
      return;
    }

    if (!code || !redirectUri || !clientId) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters',
      });
      return;
    }

    if (!codeVerifier) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing code_verifier',
      });
      return;
    }

    // Validate client
    if (!clientSecret || !validateClient(clientId, clientSecret)) {
      res.status(401).json({
        error: 'invalid_client',
        error_description: 'Invalid client credentials',
      });
      return;
    }

    if (!isValidRedirectUri(clientId, redirectUri)) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Invalid redirect_uri',
      });
      return;
    }

    // Exchange code with OIDC provider using our configured client
    const providerRedirectUri = oidcConfig.redirectUri || `${req.protocol}://${req.get('host')}/oauth/callback`;
    const tokens = await exchangeCodeForTokens(code, codeVerifier, providerRedirectUri);

    logger.info('OAuth', 'Token issued', {
      client_id: clientId,
    });

    // Return tokens to the client
    res.json({
      access_token: tokens.access_token,
      token_type: 'Bearer',
      expires_in: tokens.expires_in,
      id_token: tokens.id_token,
    });
  } catch (error) {
    logger.error('OAuth', 'Token exchange failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'server_error',
      error_description: 'Token exchange failed',
    });
  }
});
