import { Request, Response, NextFunction } from 'express';
import { oidcConfig } from '../config';
import { validateAccessToken, validateIdToken, introspectAccessToken, TokenClaims } from '../lib/oidc';
import { getSession } from '../lib/session';
import { logger } from '../lib/logger';

/**
 * Extend Express Request to include user information
 */
export interface AuthenticatedRequest extends Request {
  user?: TokenClaims;
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Authentication middleware for validating OIDC bearer tokens or session cookies.
 *
 * This middleware:
 * 1. First checks for session cookie
 * 2. If no session, checks for Bearer token in Authorization header
 * 3. Validates the token using the OIDC provider's JWKS
 * 4. Attaches user information to req.user if valid
 * 5. Returns 401 if authentication is enabled and both methods fail
 *
 * If OIDC authentication is disabled, this middleware does nothing.
 */
export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  // Skip auth if disabled
  if (!oidcConfig.enabled) {
    return next();
  }

  // Try session cookie first
  const session = await getSession(req);
  if (session?.user) {
    req.user = session.user;
    logger.debug('Auth', 'Session authenticated', {
      sub: session.user.sub,
      email: session.user.email,
      method: req.method,
      path: req.path,
    });
    return next();
  }

  // Fall back to Bearer token
  const authHeader = req.headers.authorization;
  const token = extractBearerToken(authHeader);

  if (!token) {
    logger.debug('Auth', 'No credentials provided', {
      method: req.method,
      path: req.path,
    });
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  // Try to validate as ID token first (OIDC standard - always JWT)
  try {
    const claims = await validateIdToken(token);
    req.user = claims;
    logger.debug('Auth', 'ID token authenticated', {
      sub: claims.sub,
      email: claims.email,
    });
    return next();
  } catch {
    // Not an ID token, continue to access token validation
  }

  // Try to validate as JWT access token
  try {
    const claims = await validateAccessToken(token);
    req.user = claims;
    logger.debug('Auth', 'JWT access token authenticated', {
      sub: claims.sub,
      email: claims.email,
    });
    return next();
  } catch {
    // Not a JWT, try token introspection for opaque tokens
  }

  // Fall back to token introspection (for opaque access tokens)
  try {
    const claims = await introspectAccessToken(token);
    req.user = claims;
    logger.debug('Auth', 'Opaque token authenticated', {
      sub: claims.sub,
      email: claims.email,
    });
    next();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Auth', 'Token validation failed', {
      error: errorMessage,
      method: req.method,
      path: req.path,
    });
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }
}
