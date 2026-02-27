/**
 * Optional OAuth debug endpoint.
 *
 * When enabled, exposes a small, authenticated view of the current access token claims to help
 * validate the auth flow without logging sensitive bearer tokens.
 */
import type { Request, Response, Router } from 'express';

import type { OAuthConfig } from '../../config';
import { bearerAuth } from '../middleware';

const nowSec = () => Math.floor(Date.now() / 1000);

export const registerDebugRoutes = (router: Router, cfg: OAuthConfig) => {
  router.get('/oauth/debug', bearerAuth(cfg), (req: Request, res: Response) => {
    const claims = req.mcpAuth!.claims;
    const exp = typeof claims.exp === 'number' ? claims.exp : undefined;
    const iat = typeof claims.iat === 'number' ? claims.iat : undefined;
    const remaining = exp ? Math.max(0, exp - nowSec()) : null;

    res.json({
      subject: claims.sub,
      scope: claims.scope,
      audience: claims.aud,
      issuer: claims.iss,
      iat,
      exp,
      expires_in_seconds: remaining,
      required_claims_present: cfg.oidcRequiredClaims.reduce<Record<string, boolean>>((acc, k) => {
        acc[k] = (claims as unknown as Record<string, unknown>)[k] != null;
        return acc;
      }, {}),
    });
  });
};
