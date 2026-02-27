import type { AccessTokenClaims } from '../auth/tokens';

declare global {
  namespace Express {
    interface Request {
      mcpAuth?: {
        claims: AccessTokenClaims;
      };
    }
  }
}

export {};
