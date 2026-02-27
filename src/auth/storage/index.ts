/**
 * OAuth storage selection.
 *
 * Chooses the persistence backend used by the OAuth/OIDC flow (clients, auth codes, refresh tokens,
 * user sessions, and OIDC transaction state).
 */
import type { OAuthConfig } from '../../config';

import { MemoryOAuthStorage } from './memory';
import { RedisOAuthStorage } from './redis';
import type { OAuthStorage } from './interface';

export const createOAuthStorage = (cfg: OAuthConfig): OAuthStorage => {
  if (cfg.oauthStorage === 'redis') {
    if (!cfg.redisUrl) throw new Error('redisUrl is required when oauthStorage=redis');
    return new RedisOAuthStorage(cfg.redisUrl);
  }
  return new MemoryOAuthStorage();
};

export type * from './interface';
