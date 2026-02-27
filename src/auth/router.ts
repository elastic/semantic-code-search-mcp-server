/**
 * OAuth router composition.
 *
 * Mounts all OAuth/OIDC-related endpoints (well-known metadata, dynamic client registration,
 * authorization, token exchange, and optional debug endpoints) onto a single Express router.
 */
import express from 'express';

import type { OAuthConfig } from '../config';
import type { OAuthStorage } from './storage';
import { registerAuthorizeRoutes } from './routes/authorize';
import { registerDebugRoutes } from './routes/debug';
import { registerDcrRoutes } from './routes/register';
import { registerTokenRoutes } from './routes/token';
import { registerWellKnownRoutes } from './routes/well_known';

export const createOAuthRouter = (cfg: OAuthConfig, storage: OAuthStorage) => {
  const router = express.Router();

  registerWellKnownRoutes(router, cfg);
  registerDcrRoutes(router, cfg, storage);
  registerAuthorizeRoutes(router, cfg, storage);
  registerTokenRoutes(router, cfg, storage);
  if (cfg.debugEnabled) {
    registerDebugRoutes(router, cfg);
  }

  return router;
};
