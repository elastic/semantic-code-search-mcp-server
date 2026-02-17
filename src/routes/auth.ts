import { Router, Request, Response } from 'express';
import { oidcConfig } from '../config';
import {
  generatePKCE,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  validateAccessToken,
  validateIdToken,
  getUserInfo,
} from '../lib/oidc';
import {
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  storePKCE,
  retrievePKCE,
  getSession,
  SessionUser,
} from '../lib/session';
import { logger } from '../lib/logger';

export const authRouter = Router();

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * GET /auth/login
 * Initiates the OAuth login flow
 */
authRouter.get('/login', async (req: Request, res: Response) => {
  if (!oidcConfig.enabled) {
    res.redirect('/');
    return;
  }

  try {
    // Generate PKCE challenge
    const { verifier, challenge } = await generatePKCE();

    // Generate random state for CSRF protection
    const state = crypto.randomUUID();

    // Generate nonce for ID token validation
    const nonce = crypto.randomUUID();

    // Get redirect URI from query param or use default
    const returnTo = getQueryParam(req, 'return_to') ?? '/';
    const redirectUri = oidcConfig.redirectUri || `${req.protocol}://${req.get('host')}/auth/callback`;

    // Store PKCE verifier and nonce
    await storePKCE(state, verifier, returnTo, nonce);

    // Build authorization URL and redirect
    const authUrl = await getAuthorizationUrl(state, challenge, redirectUri, nonce);

    res.redirect(authUrl);
  } catch (error) {
    logger.error('Auth', 'Failed to initiate login', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).send('Failed to initiate login');
  }
});

/**
 * GET /auth/callback
 * Handles the OAuth callback
 */
authRouter.get('/callback', async (req: Request, res: Response) => {
  if (!oidcConfig.enabled) {
    res.redirect('/');
    return;
  }

  const errorDescription = getQueryParam(req, 'error_description');

  const code = getQueryParam(req, 'code');
  const state = getQueryParam(req, 'state');
  const error = getQueryParam(req, 'error');

  // Handle OAuth errors
  if (error) {
    logger.error('Auth', 'OAuth provider returned error', { error, errorDescription });
    res.status(400).send(`Authentication Error: ${errorDescription || error}`);
    return;
  }

  // Validate required parameters
  if (!code || !state) {
    logger.error('Auth', 'Missing required callback parameters', { hasCode: !!code, hasState: !!state });
    res.status(400).send('Missing code or state parameter');
    return;
  }

  // Retrieve PKCE data
  const pkceData = await retrievePKCE(state);
  if (!pkceData) {
    logger.error('Auth', 'Invalid or expired state parameter');
    res.status(400).send('Invalid or expired state parameter');
    return;
  }

  try {
    const redirectUri = oidcConfig.redirectUri || `${req.protocol}://${req.get('host')}/auth/callback`;

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, pkceData.verifier, redirectUri);

    // Validate ID token if present
    if (tokens.id_token) {
      await validateIdToken(tokens.id_token, pkceData.nonce);
    }

    // Get user info from token or userinfo endpoint
    let user: SessionUser;
    try {
      const claims = await validateAccessToken(tokens.access_token);
      user = {
        sub: claims.sub,
        email: claims.email || claims.sub,
        name: claims.name || claims.email || claims.sub,
      };
    } catch {
      // Fallback to userinfo endpoint
      const userInfo = await getUserInfo(tokens.access_token);
      user = {
        sub: userInfo.sub,
        email: userInfo.email || userInfo.sub,
        name: userInfo.name || userInfo.email || userInfo.sub,
      };
    }

    // Create session
    const sessionToken = await createSessionToken(user, tokens.access_token, tokens.expires_in);
    setSessionCookie(res, sessionToken);

    logger.info('Auth', 'User logged in', {
      sub: user.sub,
      email: user.email,
    });

    // Show success page
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Login Successful</title>
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
            p { color: #666; margin-bottom: 24px; }
            .user-info { 
              background: #f5f5f5; 
              padding: 16px; 
              border-radius: 4px; 
              margin-bottom: 24px;
              font-family: monospace;
            }
            button {
              background: #1976d2;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 14px;
            }
            button:hover { background: #1565c0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✓ Login Successful</h1>
            <p>You are now authenticated</p>
            <div class="user-info">
              <strong>Email:</strong> ${user.email}<br>
              <strong>Name:</strong> ${user.name}
            </div>
            <button onclick="window.close()">Close Window</button>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('Auth', 'Token exchange failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).send('Failed to complete authentication');
  }
});

/**
 * GET /auth/logout
 * Clears the session
 */
authRouter.get('/logout', (req: Request, res: Response) => {
  clearSessionCookie(res);
  res.redirect('/');
});

/**
 * GET /auth/me
 * Returns the current user's information
 */
authRouter.get('/me', async (req: Request, res: Response) => {
  if (!oidcConfig.enabled) {
    res.json({
      email: 'dev@localhost',
      sub: 'dev-user',
      name: 'Development User',
    });
    return;
  }

  const session = await getSession(req);
  if (!session?.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  res.json(session.user);
});
