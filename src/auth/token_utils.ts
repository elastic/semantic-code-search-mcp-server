/**
 * Token-related helpers for the OAuth refresh-token flow.
 *
 * Refresh tokens are never stored in plaintext; we store an HMAC-derived identifier and look it up
 * during `/oauth/token` refresh requests.
 */
import { hmacSha256Hex } from './crypto';

export const hashRefreshToken = (secret: string, refreshToken: string) => {
  // HMAC (not plain hash) prevents offline guessing if token format ever changes.
  return hmacSha256Hex(secret, refreshToken);
};
